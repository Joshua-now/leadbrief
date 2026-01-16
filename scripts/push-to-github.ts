import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

function getAllFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const ignorePatterns = ['.git', 'node_modules', 'dist', '.replit', '.cache', '.upm', '.config', 'replit.nix', '.breakpoints'];
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    if (ignorePatterns.some(p => relativePath.startsWith(p) || entry.name.startsWith('.'))) {
      continue;
    }
    
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function main() {
  const repoName = 'leadbrief';
  const owner = 'Joshua-now';
  
  console.log('Getting GitHub access token...');
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });

  console.log('Getting authenticated user...');
  const { data: user } = await octokit.users.getAuthenticated();
  console.log(`Authenticated as: ${user.login}`);

  console.log(`\nPushing to ${owner}/${repoName}...`);
  
  // Get the current main branch ref
  let currentSha: string | undefined;
  try {
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo: repoName,
      ref: 'heads/main'
    });
    currentSha = ref.object.sha;
    console.log(`Current commit: ${currentSha.slice(0, 7)}`);
  } catch (e: any) {
    if (e.status === 404) {
      console.log('Branch not found, will create new');
    } else {
      throw e;
    }
  }
  
  // Get all files to push
  const baseDir = process.cwd();
  const files = getAllFiles(baseDir);
  console.log(`Found ${files.length} files to push`);
  
  // Create blobs for all files
  console.log('Creating file blobs...');
  const treeItems: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(baseDir, file));
    const { data: blob } = await octokit.git.createBlob({
      owner,
      repo: repoName,
      content: content.toString('base64'),
      encoding: 'base64'
    });
    treeItems.push({
      path: file,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
  }
  
  // Create tree
  console.log('Creating tree...');
  const { data: tree } = await octokit.git.createTree({
    owner,
    repo: repoName,
    tree: treeItems,
    base_tree: currentSha
  });
  
  // Create commit
  console.log('Creating commit...');
  const { data: commit } = await octokit.git.createCommit({
    owner,
    repo: repoName,
    message: 'LeadBrief: Final cleanup and stabilization - all verification checks pass',
    tree: tree.sha,
    parents: currentSha ? [currentSha] : []
  });
  
  // Update ref
  console.log('Updating branch reference...');
  try {
    await octokit.git.updateRef({
      owner,
      repo: repoName,
      ref: 'heads/main',
      sha: commit.sha,
      force: true
    });
  } catch (e: any) {
    if (e.status === 422) {
      await octokit.git.createRef({
        owner,
        repo: repoName,
        ref: 'refs/heads/main',
        sha: commit.sha
      });
    } else {
      throw e;
    }
  }
  
  console.log(`\n✓ Successfully pushed to GitHub!`);
  console.log(`  Commit: ${commit.sha.slice(0, 7)}`);
  console.log(`  View: https://github.com/${owner}/${repoName}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
