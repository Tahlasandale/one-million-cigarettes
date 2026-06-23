import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_PUBLIC_DIR = path.resolve(__dirname, '../public');
const PROJECT_PHOTOS_DIR = path.join(PROJECT_PUBLIC_DIR, 'photos');
const PROJECT_DATA_JSON = path.join(PROJECT_PUBLIC_DIR, 'data.json');
const EXPORT_BASE_DIR = path.join(__dirname, 'element_export');

function findExportFiles(baseDir) {
  const findInDir = (dir) => {
    const files = fs.readdirSync(dir);
    
    // Check if export.json is in this folder (JSON Export)
    if (files.includes('export.json')) {
      const jsonPath = path.join(dir, 'export.json');
      const imagesDir = path.join(dir, 'images');
      const attachmentsDir = path.join(dir, 'attachments');
      let mediaDir = fs.existsSync(imagesDir) ? imagesDir : (fs.existsSync(attachmentsDir) ? attachmentsDir : null);
      return { format: 'json', jsonPath, mediaDir };
    }
    
    // Check if messages.html is in this folder (HTML Export)
    if (files.includes('messages.html')) {
      return { format: 'html', htmlDir: dir };
    }

    // Recursively check subdirectories
    for (const f of files) {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const found = findInDir(fullPath);
        if (found) return found;
      }
    }
    return null;
  };
  
  return findInDir(baseDir);
}

function mergeMetadata(importedRecords) {
  let finalData = [];
  if (fs.existsSync(PROJECT_DATA_JSON)) {
    try {
      const existingContent = fs.readFileSync(PROJECT_DATA_JSON, 'utf8');
      const existingData = JSON.parse(existingContent || '[]');
      
      const mergedMap = new Map();
      // Load existing records first
      existingData.forEach(item => mergedMap.set(item.id, item));
      // Overwrite/add imported records
      importedRecords.forEach(item => mergedMap.set(item.id, item));
      
      // Sort reverse-chronologically (newest first)
      finalData = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.error('Could not read existing data.json, starting fresh:', e.message);
      finalData = importedRecords.sort((a, b) => b.timestamp - a.timestamp);
    }
  } else {
    finalData = importedRecords.sort((a, b) => b.timestamp - a.timestamp);
  }

  fs.writeFileSync(PROJECT_DATA_JSON, JSON.stringify(finalData, null, 2));
}

function parseJsonExport(jsonPath, mediaDir) {
  console.log(`🤖 Processing JSON format export...`);
  if (!mediaDir) {
    console.log(`❌ Error: Could not find 'images' or 'attachments' directory in the JSON export.`);
    process.exit(1);
  }

  let exportData;
  try {
    const rawData = fs.readFileSync(jsonPath, 'utf8');
    exportData = JSON.parse(rawData);
  } catch (err) {
    console.error(`❌ Failed to parse JSON file:`, err.message);
    process.exit(1);
  }

  let events = [];
  if (Array.isArray(exportData)) {
    events = exportData;
  } else if (exportData.messages && Array.isArray(exportData.messages)) {
    events = exportData.messages;
  } else if (exportData.events && Array.isArray(exportData.events)) {
    events = exportData.events;
  } else {
    console.error("❌ Invalid JSON format: Could not find events array.");
    process.exit(1);
  }

  // Build sender display name mapping
  const userMap = {};
  for (const event of events) {
    if (event.type === 'm.room.member' && event.content) {
      const sender = event.sender || event.state_key;
      const displayname = event.content.displayname;
      if (sender && displayname) {
        const oldName = userMap[sender];
        if (!oldName || (oldName.startsWith('+') && !displayname.startsWith('+'))) {
          userMap[sender] = displayname;
        }
      }
    }
  }

  // Index media files by size
  const sizeToPathMap = new Map();
  const mediaFiles = fs.readdirSync(mediaDir);
  for (const file of mediaFiles) {
    const fullPath = path.join(mediaDir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      sizeToPathMap.set(stat.size, { filename: file, fullPath });
    }
  }

  const imageEvents = events.filter(e => e.type === 'm.room.message' && e.content && e.content.msgtype === 'm.image');
  console.log(`📸 Found ${imageEvents.length} image events in JSON log.`);

  fs.mkdirSync(PROJECT_PHOTOS_DIR, { recursive: true });
  const importedRecords = [];
  let successCount = 0;
  let failCount = 0;

  for (const event of imageEvents) {
    const timestamp = event.origin_server_ts;
    const authorId = event.sender;
    const authorName = userMap[authorId] || authorId;
    const size = event.content.info?.size;

    if (!size) {
      failCount++;
      continue;
    }

    const matchedFile = sizeToPathMap.get(size);
    if (!matchedFile) {
      failCount++;
      continue;
    }

    let ext = '.jpg';
    if (event.content.info?.mimetype) {
      const mime = event.content.info.mimetype;
      if (mime.includes('png')) ext = '.png';
      else if (mime.includes('gif')) ext = '.gif';
      else if (mime.includes('webp')) ext = '.webp';
    } else {
      ext = path.extname(matchedFile.filename) || '.jpg';
    }

    const sanitizedAuthor = authorName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const eventHash = event.event_id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6);
    const targetFileName = `${timestamp}_${sanitizedAuthor}_${eventHash}${ext}`;
    const destPath = path.join(PROJECT_PHOTOS_DIR, targetFileName);

    try {
      fs.copyFileSync(matchedFile.fullPath, destPath);
      importedRecords.push({
        id: `${timestamp}_${sanitizedAuthor}`,
        timestamp,
        date: new Date(timestamp).toISOString(),
        author: authorName,
        imageUrl: `/photos/${targetFileName}`
      });
      successCount++;
    } catch (e) {
      console.error(`❌ Failed to copy file:`, e.message);
      failCount++;
    }
  }

  mergeMetadata(importedRecords);
  console.log(`\n🎉 JSON Import Complete!`);
  console.log(`- Successfully imported: ${successCount} photos`);
  console.log(`- Failed/Missing: ${failCount} photos`);
  console.log(`- Updated metadata file: ${PROJECT_DATA_JSON}`);
}

function parseHtmlExport(htmlDir) {
  console.log(`🌐 Processing HTML format export...`);
  
  const files = fs.readdirSync(htmlDir);
  const htmlFiles = files
    .filter(f => f.startsWith('messages') && f.endsWith('.html'))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, '')) || 1;
      const numB = parseInt(b.replace(/[^0-9]/g, '')) || 1;
      return numA - numB;
    });

  console.log(`Found ${htmlFiles.length} HTML page(s) to parse.`);
  
  const imagesDir = path.join(htmlDir, 'images');
  if (!fs.existsSync(imagesDir)) {
    console.error(`❌ Error: 'images' directory not found in HTML export.`);
    process.exit(1);
  }

  fs.mkdirSync(PROJECT_PHOTOS_DIR, { recursive: true });
  const importedRecords = [];
  let currentSender = "Unknown";
  let successCount = 0;
  let failCount = 0;

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(htmlDir, htmlFile);
    console.log(`📖 Parsing ${htmlFile}...`);
    const content = fs.readFileSync(htmlPath, 'utf8');
    
    // Split events by the wrapper tag
    const chunks = content.split('<div class="mx_Export_EventWrapper"');
    
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Update current sender if present in this block
      const senderMatch = chunk.match(/class="[^"]*mx_DisambiguatedProfile_displayName[^"]*"[^>]*>([^<]+)<\/span>/);
      if (senderMatch) {
        currentSender = senderMatch[1].trim();
      }

      // Check for image link: href="images/filename"
      // URL decoding is handled to support special characters
      const imageMatch = chunk.match(/href="images\/([^"]+)"/);
      if (imageMatch) {
        const urlEncodedFileName = imageMatch[1];
        const localFileName = decodeURIComponent(urlEncodedFileName);
        const srcPath = path.join(imagesDir, localFileName);
        
        if (!fs.existsSync(srcPath)) {
          console.log(`⚠️  Image file not found: ${srcPath}`);
          failCount++;
          continue;
        }

        // Parse date from file name: -DD-MM-YYYY à HH-mm-ss
        const dateMatch = localFileName.match(/(\d{2})-(\d{2})-(\d{4}) à (\d{2})-(\d{2})-(\d{2})/);
        let timestamp;
        if (dateMatch) {
          const [_, day, month, year, hour, minute, second] = dateMatch;
          const dateStr = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
          timestamp = new Date(dateStr).getTime();
        } else {
          const stat = fs.statSync(srcPath);
          timestamp = stat.mtimeMs;
        }

        // Extract event ID for unique hash
        const idMatch = chunk.match(/^ id="([^"]+)"/);
        const eventId = idMatch ? idMatch[1] : `event_${timestamp}`;
        const eventHash = eventId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6);

        const ext = path.extname(srcPath) || '.jpg';
        const sanitizedAuthor = currentSender.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const targetFileName = `${timestamp}_${sanitizedAuthor}_${eventHash}${ext}`;
        const destPath = path.join(PROJECT_PHOTOS_DIR, targetFileName);

        try {
          fs.copyFileSync(srcPath, destPath);
          importedRecords.push({
            id: `${timestamp}_${sanitizedAuthor}`,
            timestamp,
            date: new Date(timestamp).toISOString(),
            author: currentSender,
            imageUrl: `/photos/${targetFileName}`
          });
          successCount++;
        } catch (e) {
          console.error(`❌ Failed to copy file ${localFileName}:`, e.message);
          failCount++;
        }
      }
    }
  }

  mergeMetadata(importedRecords);
  console.log(`\n🎉 HTML Import Complete!`);
  console.log(`- Successfully imported: ${successCount} photos`);
  console.log(`- Failed/Missing: ${failCount} photos`);
  console.log(`- Updated metadata file: ${PROJECT_DATA_JSON}`);
}

async function start() {
  if (!fs.existsSync(EXPORT_BASE_DIR)) {
    console.log(`❌ Error: Export folder not found at ${EXPORT_BASE_DIR}.`);
    process.exit(1);
  }

  const exportInfo = findExportFiles(EXPORT_BASE_DIR);
  if (!exportInfo) {
    console.log(`❌ Error: Could not find any valid JSON or HTML Matrix export in ${EXPORT_BASE_DIR}.`);
    process.exit(1);
  }

  if (exportInfo.format === 'json') {
    parseJsonExport(exportInfo.jsonPath, exportInfo.mediaDir);
  } else if (exportInfo.format === 'html') {
    parseHtmlExport(exportInfo.htmlDir);
  }
}

start();
