import { rmSync } from 'node:fs';

for (const path of [
  'dist',
  '.vite',
  'node_modules/.vite',
  'node_modules/.cache',
  'src-tauri/gen',
]) {
  rmSync(path, { force: true, recursive: true });
}
