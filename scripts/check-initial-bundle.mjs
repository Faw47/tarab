import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const distDir = resolve('dist');
const manifestPath = resolve(distDir, '.vite/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = [
  { label: 'main', htmlPath: 'index.html', rawBudget: 1_100_000, gzipBudget: 350_000 },
  {
    label: 'mini-player',
    htmlPath: 'mini-player.html',
    rawBudget: 500_000,
    gzipBudget: 180_000,
  },
];

function getEntryKeys(htmlPath, label) {
  const html = readFileSync(resolve(distDir, htmlPath), 'utf8');
  const scriptSources = [...html.matchAll(/<script\b([^>]*)>/gi)]
    .filter(([, attributes]) => /\btype=["']module["']/i.test(attributes))
    .map(([, attributes]) => attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1])
    .filter((source) => typeof source === 'string');

  const keys = scriptSources.map((source) => {
    const assetPath = source
      .split(/[?#]/, 1)[0]
      .replaceAll('\\', '/')
      .replace(/^\.?\//, '')
      .replace(/^\/+/, '');
    const key = Object.entries(manifest).find(
      ([, chunk]) => chunk.file?.replaceAll('\\', '/') === assetPath,
    )?.[0];

    if (!key) {
      throw new Error(
        `${label} HTML entry points to JavaScript missing from the Vite manifest: "${source}"`,
      );
    }
    return key;
  });

  if (keys.length === 0) {
    throw new Error(`${label} HTML entry has no module script source`);
  }

  return { html, keys };
}

function getInitialJavaScriptFiles(entryKeys, label) {
  const visited = new Set();
  const files = new Set();
  const pending = [...entryKeys];

  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);

    const chunk = manifest[key];
    if (!chunk) {
      throw new Error(`${label} bundle manifest is missing import "${key}"`);
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
    throw new Error(`${label} initial bundle has no JavaScript files`);
  }

  return [...files];
}

function formatBytes(bytes) {
  return `${new Intl.NumberFormat('en-US').format(bytes)} B`;
}

let failed = false;
for (const entry of entries) {
  const { html, keys } = getEntryKeys(entry.htmlPath, entry.label);
  const files = getInitialJavaScriptFiles(keys, entry.label);
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

  if (/rel="modulepreload"[^>]+three-stack/.test(html)) {
    console.error(`${entry.htmlPath} eagerly preloads the optional Three.js bundle`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
