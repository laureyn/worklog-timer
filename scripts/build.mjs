#!/usr/bin/env node
// Stages the extension for distribution in dist/worklog-timer/, leaving out repo-only files.
// Usage: node scripts/build.mjs [version]
//   version (optional, e.g. 1.2.0 or v1.2.0) is written into the staged manifest only.
//   Without it, the version in manifest.json is used.
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'worklog-timer');
const INCLUDE = ['background.js', 'manifest.json', 'options.html', 'options.js', 'panel.html',
  'popup.css', 'popup.html', 'popup.js', 'icons', 'src', 'LICENSE', 'PRIVACY.md', 'README.md'];
// Chrome accepts 1 to 4 dot-separated integers, each at most 65535.
const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

const requested = process.argv[2]?.replace(/^v/, '');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (requested) manifest.version = requested;
if (!VERSION_RE.test(manifest.version)) {
  throw new Error(`Invalid version "${manifest.version}". Use 1 to 4 numbers separated by dots, e.g. 1.2.0.`);
}

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const f of INCLUDE) cpSync(join(root, f), join(outDir, f), { recursive: true });
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Every file the manifest points to must exist in the staged copy.
const refs = [
  manifest.background?.service_worker, manifest.background?.scripts?.[0],
  manifest.action?.default_popup, ...Object.values(manifest.action?.default_icon || {}),
  manifest.side_panel?.default_path, manifest.options_page, ...Object.values(manifest.icons || {}),
].filter(Boolean);
for (const r of refs) {
  if (!existsSync(join(outDir, r))) throw new Error(`manifest.json references a missing file: ${r}`);
}
console.log(`Staged ${manifest.name} ${manifest.version} in dist/worklog-timer`);
