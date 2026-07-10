import path from 'node:path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  define: {
    __DEV__: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
    clearMocks: true,
    server: {
      deps: {
        inline: ['html-encoding-sniffer'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src-tauri/**', '**/*.d.ts', 'src/test/**'],
    },
  },
});
