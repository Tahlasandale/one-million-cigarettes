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

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    return res.status(500).json({
      error: 'GitHub configuration missing in environment variables on Vercel.',
    });
  }

  const octokit = new Octokit({ auth: token });

  // Extract base64 image data and extension
  const matches = image.match(/^data:image\/([A-Za-z+]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
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
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: imagePath,
      message: `Upload photo: ${fileName} by ${author}`,
      content: base64Data,
    });

    const newRecord = {
      id,
      timestamp,
      date: new Date(timestamp).toISOString(),
      author: author.trim(),
      imageUrl: `/photos/${fileName}`,
    };

    // 2. Commit the update to public/data.json with conflict retry loop
    const maxRetries = 3;
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries) {
      attempt++;
      try {
        let currentSha: string | undefined;
        let currentData: unknown[] = [];

        try {
          const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: 'public/data.json',
          });

          // Check if response data is the file content format we expect
          if (response.data && !Array.isArray(response.data) && 'content' in response.data) {
            const fileData = response.data as GitHubContentResponse;
            currentSha = fileData.sha;
            const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
            currentData = JSON.parse(content) as unknown[];
          }
        } catch (e: unknown) {
          const err = e as { status?: number };
          if (err.status !== 404) {
            throw e;
          }
          // If data.json does not exist, we just keep currentData as empty array
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
        break;
      } catch (error: unknown) {
        const err = error as { status?: number };
        if (err.status === 409 && attempt < maxRetries) {
          // Commit conflict, wait briefly and retry
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
    const error = err as Error;
    console.error('Upload error:', error);
    return res.status(500).json({
      error: 'Failed to upload photo to GitHub.',
      details: error.message,
    });
  }
}
