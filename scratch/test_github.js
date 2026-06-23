import { Octokit } from 'octokit';

const token = process.env.GITHUB_TOKEN;
const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

console.log('Testing GitHub Upload with token...');
console.log('Owner:', owner);
console.log('Repo:', repo);

if (!token || !owner || !repo) {
  console.error('Missing env variables!');
  process.exit(1);
}

const octokit = new Octokit({ auth: token });

async function run() {
  try {
    // Attempt to write a test file
    console.log('Attempting to write test file to GitHub...');
    const res = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: 'public/photos/test_connection.txt',
      message: 'test: verify write permissions',
      content: Buffer.from('connection test success').toString('base64'),
    });
    console.log('SUCCESS! File created on GitHub:', res.data.content?.html_url);
    
    // Clean up
    console.log('Cleaning up test file...');
    await octokit.rest.repos.deleteFile({
      owner,
      repo,
      path: 'public/photos/test_connection.txt',
      message: 'test: clean up connection test file',
      sha: res.data.content?.sha || '',
    });
    console.log('Clean up done.');
  } catch (err) {
    console.error('ERROR during testing:', err);
  }
}

run();
