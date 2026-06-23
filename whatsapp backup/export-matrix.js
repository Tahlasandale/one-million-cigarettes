import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Helper for ESM paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load environment variables from the root .env
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      // Parse key = val, ignoring comments
      const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)\s*$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        // Remove quotes if present
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const HOMESERVER = process.env.BEEPER_HOMESERVER || 'https://matrix.beeper.com';
const ACCESS_TOKEN = process.env.BEEPER_ACCESS_TOKEN;
const ROOM_ID = process.env.BEEPER_ROOM_ID;
const PROJECT_PUBLIC_DIR = path.resolve(__dirname, '../public');

// Display usage info
function showHelp() {
  console.log(`
📱 Beeper/Matrix WhatsApp Backup Downloader
==========================================
This script downloads photos and metadata from your bridged WhatsApp chat on Beeper.

Required configuration (in your root .env file):
  BEEPER_ACCESS_TOKEN=your_token_here (Copy from Beeper Desktop Settings -> Help & About -> Advanced)
  BEEPER_ROOM_ID=!room:beeper.com    (Get using --list command)

Commands:
  node export-matrix.js --list   List all joined rooms to find your WhatsApp chat's Room ID
  node export-matrix.js          Download history and photos
  node export-matrix.js --merge  Download and directly merge into your web app (public/photos and public/data.json)
`);
}

// Helper to query Matrix API
async function apiRequest(endpoint, params = {}, method = 'GET', body = null) {
  const url = new URL(`${HOMESERVER}${endpoint}`);
  Object.entries(params).forEach(([key, val]) => url.searchParams.append(key, val));
  
  const headers = {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API Request to ${endpoint} failed (${res.status}): ${errText}`);
  }

  return res.json();
}

// Display Name Cache to avoid duplicate profile fetches
const nameCache = {};

async function getDisplayName(userId, roomId) {
  if (nameCache[userId]) return nameCache[userId];
  
  try {
    // Try to get room member state event for the user
    const state = await apiRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(userId)}`);
    if (state.displayname) {
      nameCache[userId] = state.displayname;
      return state.displayname;
    }
  } catch (e) {
    // Fallback to global profile endpoint
    try {
      const profile = await apiRequest(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`);
      if (profile.displayname) {
        nameCache[userId] = profile.displayname;
        return profile.displayname;
      }
    } catch (e2) {}
  }
  
  // If all fails, parse user ID to a friendlier name if it is a WhatsApp bridge contact
  // e.g. @whatsapp_33612345678:beeper.com -> wa_33612345678
  let friendly = userId;
  const match = userId.match(/^@([^:]+):/);
  if (match) {
    friendly = match[1];
  }
  nameCache[userId] = friendly;
  return friendly;
}

// List all joined rooms and their names/aliases
async function listRooms() {
  console.log('🔄 Fetching your joined Beeper rooms list...');
  try {
    const joined = await apiRequest('/_matrix/client/v3/joined_rooms');
    const roomIds = joined.joined_rooms;
    console.log(`Found ${roomIds.length} joined rooms. Fetching names (this might take a moment)...`);

    const roomsList = [];
    
    // Batch room details retrieval (concurrency limit of 10 to avoid overloading API)
    const limit = 10;
    for (let i = 0; i < roomIds.length; i += limit) {
      const batch = roomIds.slice(i, i + limit);
      const promises = batch.map(async (roomId) => {
        try {
          // Fetch room name
          const stateName = await apiRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`).catch(() => null);
          let name = stateName?.name;

          if (!name) {
            // Try canonical alias
            const stateAlias = await apiRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.canonical_alias`).catch(() => null);
            name = stateAlias?.alias;
          }

          // If no name, check if it's a bridged WhatsApp room
          if (!name) {
            name = roomId;
          }
          
          return { roomId, name };
        } catch {
          return { roomId, name: roomId };
        }
      });
      
      const results = await Promise.all(promises);
      roomsList.push(...results);
      process.stdout.write(`Processed ${Math.min(i + limit, roomIds.length)}/${roomIds.length} rooms...\r`);
    }
    console.log('\n');

    // Filter to highlight potential WhatsApp bridged groups
    console.log('----------------------------------------------------');
    console.log('📱 POTENTIAL WHATSAPP CHATS AND RECENT GROUPS:');
    console.log('----------------------------------------------------');
    const whatsappRooms = roomsList.filter(r => 
      r.name.toLowerCase().includes('whatsapp') || 
      r.name.toLowerCase().includes('wa') ||
      r.roomId.includes('whatsapp')
    );

    if (whatsappRooms.length > 0) {
      whatsappRooms.forEach(r => {
        console.log(`✨ [WhatsApp Option] \x1b[32mName: ${r.name}\x1b[0m`);
        console.log(`   Room ID: ${r.roomId}`);
      });
    }

    console.log('\n----------------------------------------------------');
    console.log('👥 ALL ROOMS:');
    console.log('----------------------------------------------------');
    roomsList.forEach(r => {
      console.log(`Name: ${r.name}`);
      console.log(`Room ID: ${r.roomId}`);
      console.log('---');
    });

    console.log('\n💡 Copy the Room ID of your WhatsApp chat.');
    console.log('Then, add it to your .env file:');
    console.log('BEEPER_ROOM_ID=your_copied_room_id');
  } catch (err) {
    console.error('❌ Error listing rooms:', err.message);
  }
}

// Download media from MXC url
async function downloadMedia(mxcUrl, destPath) {
  if (!mxcUrl.startsWith('mxc://')) return false;
  
  const mxcParts = mxcUrl.substring(6).split('/');
  const domain = mxcParts[0];
  const mediaId = mxcParts.slice(1).join('/');
  
  const url = `${HOMESERVER}/_matrix/media/v3/download/${domain}/${mediaId}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      }
    });

    if (!res.ok) {
      console.error(`\n❌ Failed to download ${mxcUrl}: HTTP ${res.status}`);
      return false;
    }

    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
    return true;
  } catch (err) {
    console.error(`\n❌ Error downloading ${mxcUrl}:`, err.message);
    return false;
  }
}

// Export messages and media
async function runExport(mergeDirectly = false) {
  if (!ROOM_ID) {
    console.error('❌ Error: BEEPER_ROOM_ID is not configured in .env.');
    console.log('Please run "node export-matrix.js --list" to find your Room ID first.');
    process.exit(1);
  }

  const exportDir = path.join(__dirname, 'exported_data');
  const localPhotosDir = path.join(exportDir, 'photos');
  
  // Set target directories
  const targetPhotosDir = mergeDirectly ? path.join(PROJECT_PUBLIC_DIR, 'photos') : localPhotosDir;
  const targetMetadataPath = mergeDirectly ? path.join(PROJECT_PUBLIC_DIR, 'data.json') : path.join(exportDir, 'export.json');

  console.log(`🔄 Starting WhatsApp export from Beeper room: ${ROOM_ID}`);
  console.log(`📁 Destination for photos: ${targetPhotosDir}`);
  console.log(`📄 Destination for metadata: ${targetMetadataPath}`);

  // Ensure directories exist
  fs.mkdirSync(targetPhotosDir, { recursive: true });

  const imageEvents = [];
  let currentToken = null;
  let hasMore = true;
  let pageCount = 0;

  console.log('⏳ Scanning chat history for images...');

  while (hasMore) {
    pageCount++;
    const params = {
      dir: 'b',
      limit: '100',
    };
    if (currentToken) {
      params.from = currentToken;
    }

    try {
      const res = await apiRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(ROOM_ID)}/messages`, params);
      
      if (!res.chunk || res.chunk.length === 0) {
        break;
      }

      for (const event of res.chunk) {
        if (event.type === 'm.room.message' && event.content) {
          // Check if message is an image
          if (event.content.msgtype === 'm.image') {
            imageEvents.push(event);
          }
        }
      }

      process.stdout.write(`Scanned ${pageCount * 100} messages. Found ${imageEvents.length} images...\r`);

      if (!res.end || res.end === currentToken) {
        hasMore = false;
      } else {
        currentToken = res.end;
      }
    } catch (err) {
      console.error(`\n❌ Error fetching message history:`, err.message);
      break;
    }
  }

  console.log(`\n✅ Scan complete. Found ${imageEvents.length} images in total.`);
  
  if (imageEvents.length === 0) {
    console.log('No images found to export.');
    return;
  }

  console.log('🔄 Fetching user names and downloading images...');
  const metadataList = [];

  for (let idx = 0; idx < imageEvents.length; idx++) {
    const event = imageEvents[idx];
    const timestamp = event.origin_server_ts;
    const authorId = event.sender;
    const mxcUrl = event.content.url;
    
    // Get sender displayname
    const authorName = await getDisplayName(authorId, ROOM_ID);
    
    // Determine file extension
    let ext = 'jpg';
    if (event.content.info?.mimetype) {
      const mime = event.content.info.mimetype;
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('webp')) ext = 'webp';
    }

    // Standardize naming: timestamp_author_hash.ext
    const sanitizedAuthor = authorName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const eventHash = event.event_id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6);
    const fileName = `${timestamp}_${sanitizedAuthor}_${eventHash}.${ext}`;
    const destPath = path.join(targetPhotosDir, fileName);

    process.stdout.write(`[${idx + 1}/${imageEvents.length}] Downloading image for ${authorName}... `);

    // Download the file
    const downloadSuccess = await downloadMedia(mxcUrl, destPath);
    if (downloadSuccess) {
      // Build record format matching the web application
      metadataList.push({
        id: `${timestamp}_${sanitizedAuthor}`,
        timestamp,
        date: new Date(timestamp).toISOString(),
        author: authorName,
        imageUrl: `/photos/${fileName}`
      });
      console.log('✅ Success');
    } else {
      console.log('❌ Failed');
    }
  }

  // Handle merging/saving of metadata JSON
  let finalData = [];
  if (mergeDirectly && fs.existsSync(targetMetadataPath)) {
    try {
      const existingContent = fs.readFileSync(targetMetadataPath, 'utf8');
      const existingData = JSON.parse(existingContent || '[]');
      
      // Combine and deduplicate by ID
      const mergedMap = new Map();
      // Add existing records first
      existingData.forEach(item => mergedMap.set(item.id, item));
      // Add new imported records (will overwrite if same ID exists)
      metadataList.forEach(item => mergedMap.set(item.id, item));
      
      // Convert map back to array and sort reverse-chronologically (newest first)
      finalData = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.error('Could not read existing data.json, starting fresh:', e.message);
      finalData = metadataList.sort((a, b) => b.timestamp - a.timestamp);
    }
  } else {
    // Isolated export: sort reverse-chronologically
    finalData = metadataList.sort((a, b) => b.timestamp - a.timestamp);
  }

  fs.writeFileSync(targetMetadataPath, JSON.stringify(finalData, null, 2));

  console.log(`\n🎉 Export complete!`);
  console.log(`- Successfully processed and saved ${metadataList.length} photos.`);
  console.log(`- Updated metadata records in: ${targetMetadataPath}`);
  
  if (!mergeDirectly) {
    console.log(`\n💡 To apply this backup to your app, copy files from '${exportDir}/photos' to 'public/photos/' and merge 'export.json' into 'public/data.json'.`);
    console.log(`Alternatively, run: node export-matrix.js --merge`);
  } else {
    console.log(`\n🚀 The photos and metadata are now merged in your public folder! Try running 'npm run dev' to see the imported feed.`);
  }
}

// CLI entry point
const args = process.argv.slice(2);

if (!ACCESS_TOKEN) {
  console.error('❌ Error: BEEPER_ACCESS_TOKEN is not defined in your environment or .env file.');
  console.log('Please see instructions on how to retrieve your Beeper access token.');
  showHelp();
  process.exit(1);
}

if (args.includes('--list') || args.includes('-l')) {
  listRooms();
} else if (args.includes('--merge') || args.includes('-m')) {
  runExport(true);
} else if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else {
  // If BEEPER_ROOM_ID is not provided, help the user list rooms
  if (!ROOM_ID) {
    console.log('ℹ️  BEEPER_ROOM_ID not found in environment, running in --list mode to help you find it.');
    listRooms();
  } else {
    runExport(false);
  }
}
