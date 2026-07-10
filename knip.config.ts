import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/mini-player.tsx', 'src/workers/library.worker.ts'],
  project: ['src/**/*.{ts,tsx,css}', '.storybook/**/*.ts'],
  ignore: ['src/test/storybook/**'],
  ignoreBinaries: ['open'],
  ignoreDependencies: ['@tauri-apps/plugin-positioner', '@tauri-apps/plugin-window-state'],
  rules: {
    exports: 'off',
    types: 'off',
    duplicates: 'off',
  },
};

export default config;
