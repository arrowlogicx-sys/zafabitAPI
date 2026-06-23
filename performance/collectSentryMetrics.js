 
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { artifactsDir } = require('./config');

const request = async (url, token) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_error) {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok)
    throw new Error(
      `Sentry API ${response.status}: ${body.detail || body.raw || 'request failed'}`,
    );
  return body;
};

const main = async () => {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const token = process.env.SENTRY_AUTH_TOKEN;
  const organization = process.env.SENTRY_ORG;
  const projects = [process.env.SENTRY_FRONTEND_PROJECT, process.env.SENTRY_BACKEND_PROJECT].filter(
    Boolean,
  );
  const output = {
    generatedAt: new Date().toISOString(),
    organization,
    projects: [],
    status: 'not_configured',
  };

  if (!token || !organization || projects.length !== 2) {
    output.reason =
      'SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_FRONTEND_PROJECT, and SENTRY_BACKEND_PROJECT are required.';
  } else {
    output.status = 'collected';
    for (const project of projects) {
      try {
        const [metadata, unresolvedIssues] = await Promise.all([
          request(
            `https://sentry.io/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/`,
            token,
          ),
          request(
            `https://sentry.io/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/issues/?query=is%3Aunresolved&statsPeriod=24h&limit=100`,
            token,
          ),
        ]);
        output.projects.push({
          slug: project,
          id: metadata.id,
          platform: metadata.platform,
          unresolvedIssueCountReturned: unresolvedIssues.length,
          unresolvedIssues: unresolvedIssues.slice(0, 20).map((issue) => ({
            id: issue.id,
            title: issue.title,
            count: Number(issue.count || 0),
            userCount: Number(issue.userCount || 0),
            firstSeen: issue.firstSeen,
            lastSeen: issue.lastSeen,
            permalink: issue.permalink,
          })),
        });
      } catch (error) {
        output.status = 'partial';
        output.projects.push({ slug: project, error: error.message });
      }
    }
  }

  const destination = path.join(artifactsDir, 'sentry-audit.json');
  fs.writeFileSync(destination, JSON.stringify(output, null, 2));
  console.log(`Sentry audit status: ${output.status}.`);
  return output;
};

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main };
