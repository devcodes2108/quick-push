import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('dist');
const manifestPath = resolve(dist, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error('Missing dist/manifest.json. Run the build first.');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const contentPaths = manifest.content_scripts?.flatMap((script) => script.js ?? []) ?? [];
if (contentPaths.length !== 1) throw new Error('Expected exactly one manifest content-script asset.');

for (const asset of [manifest.background?.service_worker, ...contentPaths]) {
  if (typeof asset !== 'string' || !existsSync(resolve(dist, asset))) throw new Error(`Manifest references a missing asset: ${asset}`);
}

const content = readFileSync(resolve(dist, contentPaths[0]), 'utf8');
if (/^\s*(?:import|export)\b/m.test(content)) throw new Error('Content script contains a top-level ES module statement.');
if (content.includes('./chunks/') || content.includes('/chunks/')) throw new Error('Content script depends on a generated chunk.');

console.log(`Verified classic self-contained content script: ${contentPaths[0]}`);
