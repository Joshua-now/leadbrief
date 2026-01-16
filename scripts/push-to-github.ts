import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';

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

async function main() {
  const repoName = 'leadbrief';
  
  console.log('Getting GitHub access token...');
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });

  console.log('Getting authenticated user...');
  const { data: user } = await octokit.users.getAuthenticated();
  console.log(`Authenticated as: ${user.login}`);

  console.log(`Creating repository: ${repoName}...`);
  try {
    await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'LeadBrief - Bulk contact enrichment platform with CSV/JSON import, validation, and self-healing capabilities',
      private: false,
      auto_init: false,
    });
    console.log(`Repository created: https://github.com/${user.login}/${repoName}`);
  } catch (error: any) {
    if (error.status === 422) {
      console.log('Repository already exists, will push to existing repo');
    } else {
      throw error;
    }
  }

  console.log('Configuring git remote...');
  const remoteUrl = `https://github.com/${user.login}/${repoName}.git`;
  
  try {
    execSync('git remote remove origin', { stdio: 'pipe' });
  } catch (e) {
  }
  
  execSync(`git remote add origin ${remoteUrl}`, { stdio: 'inherit' });

  console.log('Pushing to GitHub...');
  execSync(`git -c http.extraHeader="Authorization: Bearer ${accessToken}" push -u origin main --force`, { stdio: 'inherit' });
  
  console.log(`\nSuccess! Your code is now at: https://github.com/${user.login}/${repoName}`);
}

main().catch(console.error);
