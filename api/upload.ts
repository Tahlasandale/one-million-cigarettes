import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Octokit } from 'octokit';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Support base64 images up to 10MB
    },
  },
};

interface GitHubContentResponse {
  sha: string;
  content: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { image, author } = req.body;

  if (!image || !author) {
    return res.status(400).json({ error: 'Missing image or author' });
  }

  const token = process.env.GITHUB_TOKEN?.trim();
  const owner = process.env.GITHUB_OWNER?.trim();
  const repo = process.env.GITHUB_REPO?.trim();

  console.log(`[API Upload] Request received. Author: "${author}". Image length: ${image?.length} chars.`);
  console.log(`[API Upload] Target Repo config: Owner="${owner}", Repo="${repo}", Token present=${!!token}`);

  if (!token || !owner || !repo) {
    return res.status(500).json({
      error: 'GitHub configuration missing in environment variables on Vercel.',
      details: `Token present: ${!!token}, Owner: "${owner || 'missing'}", Repo: "${repo || 'missing'}"`,
    });
  }

  const octokit = new Octokit({ auth: token });

  // Extract base64 image data and extension
  const matches = image.match(/^data:image\/([A-Za-z+]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    console.error(`[API Upload ERROR] Invalid image payload format.`);
    return res.status(400).json({ error: 'Invalid image format' });
  }

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const base64Data = matches[2];

  const timestamp = Date.now();
  const sanitizedAuthor = author.trim().replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const id = `${timestamp}_${sanitizedAuthor}`;
  const fileName = `${id}.${ext}`;
  const imagePath = `public/photos/${fileName}`;

  try {
    // 1. Commit the photo to public/photos/
    console.log(`[API Upload] Step 1/2: Committing image file to Git at "${imagePath}"...`);
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: imagePath,
      message: `Upload photo: ${fileName} by ${author}`,
      content: base64Data,
    });
    console.log(`[API Upload] Step 1/2 SUCCESS: Image file created.`);

    const newRecord = {
      id,
      timestamp,
      date: new Date(timestamp).toISOString(),
      author: author.trim(),
      imageUrl: `/photos/${fileName}`,
    };

    // 2. Commit the update to public/data.json with conflict retry loop
    console.log(`[API Upload] Step 2/2: Updating "public/data.json" with conflict resolution...`);
    const maxRetries = 3;
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries) {
      attempt++;
      console.log(`[API Upload] Attempt ${attempt} to commit data.json...`);
      try {
        let currentSha: string | undefined;
        let currentData: unknown[] = [];

        try {
          const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: 'public/data.json',
          });

          if (response.data && !Array.isArray(response.data) && 'content' in response.data) {
            const fileData = response.data as GitHubContentResponse;
            currentSha = fileData.sha;
            const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
            currentData = JSON.parse(content) as unknown[];
          }
        } catch (e: unknown) {
          const err = e as { status?: number };
          if (err.status !== 404) {
            console.error(`[API Upload ERROR] Failed to fetch data.json content:`, e);
            throw e;
          }
          console.log(`[API Upload] public/data.json does not exist. Initializing new array.`);
        }

        const updatedData = [newRecord, ...currentData];

        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: 'public/data.json',
          message: `Update feed: add photo by ${author}`,
          content: Buffer.from(JSON.stringify(updatedData, null, 2)).toString('base64'),
          sha: currentSha,
        });

        success = true;
        console.log(`[API Upload] Step 2/2 SUCCESS: data.json updated on attempt ${attempt}.`);
        break;
      } catch (error: unknown) {
        const err = error as { status?: number };
        if (err.status === 409 && attempt < maxRetries) {
          console.warn(`[API Upload WARNING] Conflict (409) detected on attempt ${attempt}. Retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          continue;
        }
        throw error;
      }
    }

    if (!success) {
      throw new Error('Failed to update metadata due to too many conflicts.');
    }

    return res.status(200).json({
      success: true,
      photo: newRecord,
    });
  } catch (err: unknown) {
    const error = err as { 
      message?: string; 
      status?: number; 
      response?: { data?: { message?: string } };
    };
    console.error('[API Upload ERROR] Full error trace:', error);
    
    let detailedMessage = error.message || 'Unknown error';
    if (error.response && error.response.data && error.response.data.message) {
      detailedMessage += ` - GitHub API: ${error.response.data.message}`;
    }

    return res.status(500).json({
      error: 'Failed to upload photo to GitHub.',
      details: detailedMessage,
      status: error.status,
    });
  }
}
