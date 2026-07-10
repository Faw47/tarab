import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const storybookMocks = path.resolve(root, 'src', 'test', 'storybook');

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...(Array.isArray(config.resolve?.alias) ? {} : config.resolve?.alias),
        '@': path.resolve(root, 'src'),
        '@tauri-apps/api/core': path.resolve(storybookMocks, 'tauri-api-core.ts'),
        '@tauri-apps/api/event': path.resolve(storybookMocks, 'tauri-api-event.ts'),
        '@tauri-apps/api/window': path.resolve(storybookMocks, 'tauri-api-window.ts'),
        '@tauri-apps/plugin-autostart': path.resolve(storybookMocks, 'tauri-plugin-autostart.ts'),
        '@tauri-apps/plugin-clipboard-manager': path.resolve(
          storybookMocks,
          'tauri-plugin-clipboard-manager.ts',
        ),
        '@tauri-apps/plugin-dialog': path.resolve(storybookMocks, 'tauri-plugin-dialog.ts'),
        '@tauri-apps/plugin-opener': path.resolve(storybookMocks, 'tauri-plugin-opener.ts'),
        '@tauri-apps/plugin-store': path.resolve(storybookMocks, 'tauri-plugin-store.ts'),
      },
    },
    define: {
      ...config.define,
      __DEV__: JSON.stringify(true),
    },
  }),
};

export default config;
