import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, sep } from 'node:path';

const distDir = resolve('dist');
const manifestPath = resolve(distDir, '.vite/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = [
  { label: 'main', key: 'src/main.tsx', rawBudget: 1_100_000, gzipBudget: 350_000 },
  {
    label: 'mini-player',
    key: 'src/mini-player.tsx',
    rawBudget: 500_000,
    gzipBudget: 180_000,
  },
];

function getInitialJavaScriptFiles(entryKey) {
  const visited = new Set();
  const files = new Set();
  const pending = [entryKey];

  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);

    const chunk = manifest[key];
    if (!chunk) {
      throw new Error(`Initial bundle manifest is missing entry or import "${key}"`);
    }

    if (typeof chunk.file === 'string' && /\.m?js$/i.test(chunk.file)) {
      const path = resolve(distDir, chunk.file);
      if (path !== distDir && !path.startsWith(`${distDir}${sep}`)) {
        throw new Error(`Initial bundle manifest references a file outside dist: "${chunk.file}"`);
      }
      files.add(path);
    }

    for (const importedKey of chunk.imports ?? []) {
      pending.push(importedKey);
    }
  }

  if (files.size === 0) {
    throw new Error(`Initial bundle entry "${entryKey}" has no JavaScript files`);
  }

  return [...files];
}

function formatBytes(bytes) {
  return `${new Intl.NumberFormat('en-US').format(bytes)} B`;
}

let failed = false;
for (const entry of entries) {
  const files = getInitialJavaScriptFiles(entry.key);
  const rawBytes = files.reduce((total, path) => total + readFileSync(path).byteLength, 0);
  const gzipBytes = files.reduce(
    (total, path) => total + gzipSync(readFileSync(path)).byteLength,
    0,
  );

  console.log(
    `${entry.label} initial JS: ${formatBytes(rawBytes)} raw / ${formatBytes(gzipBytes)} gzip (budgets: ${formatBytes(entry.rawBudget)} raw / ${formatBytes(entry.gzipBudget)} gzip)`,
  );

  const exceeded = [];
  if (rawBytes > entry.rawBudget) exceeded.push('raw');
  if (gzipBytes > entry.gzipBudget) exceeded.push('gzip');
  if (exceeded.length > 0) {
    console.error(`${entry.label} initial JS ${exceeded.join(' and ')} budget exceeded`);
    failed = true;
  }
}

for (const path of ['index.html', 'mini-player.html']) {
  const html = readFileSync(resolve(distDir, path), 'utf8');
  if (/rel="modulepreload"[^>]+three-stack/.test(html)) {
    console.error(`${path} eagerly preloads the optional Three.js bundle`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
