import { readFileSync } from 'node:fs';

for (const path of ['dist/index.html', 'dist/mini-player.html']) {
  const html = readFileSync(path, 'utf8');
  if (/rel="modulepreload"[^>]+three-stack/.test(html)) {
    throw new Error(`${path} eagerly preloads the optional Three.js bundle`);
  }
}
