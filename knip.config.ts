import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/main.tsx', 'src/mini-player.tsx', 'src/workers/library.worker.ts'],
  project: ['src/**/*.{ts,tsx,css}', 'vite.config.ts', 'vitest.config.ts'],
  ignore: ['src-tauri/**'],
  ignoreBinaries: ['open'],
  ignoreDependencies: [
    '@tauri-apps/plugin-positioner',
    '@tauri-apps/plugin-os',
    '@tauri-apps/plugin-window-state',
    'tailwindcss',
  ],
  rules: {
    exports: 'off',
    types: 'off',
    duplicates: 'off',
  },
};

export default config;
