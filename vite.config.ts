import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'analyze'
      ? [
          visualizer({
            filename: 'bundle-report.html',
            emitFile: true,
            open: false,
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  worker: {
    format: 'es',
  },
  define: {
    __DEV__: JSON.stringify(mode !== 'production'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        miniPlayer: path.resolve(__dirname, 'mini-player.html'),
      },
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/');
          if (
            normalizedId.includes('vite/preload-helper') ||
            normalizedId.includes('/react@') ||
            normalizedId.includes('/react-dom@') ||
            normalizedId.includes('/scheduler@') ||
            normalizedId.includes('/zustand@') ||
            normalizedId.includes('/use-sync-external-store@')
          ) {
            return 'react-runtime';
          }
          if (!normalizedId.includes('node_modules')) return;
          if (
            normalizedId.includes('three') ||
            normalizedId.includes('@react-three/fiber') ||
            normalizedId.includes('@react-three/drei')
          ) {
            return 'three-stack';
          }
          if (normalizedId.includes('framer-motion')) {
            return 'motion';
          }
          if (normalizedId.includes('lucide-react')) {
            return 'icons';
          }
          if (
            normalizedId.includes('@tauri-apps/api') ||
            normalizedId.includes('@tauri-apps/plugin-opener')
          ) {
            return 'tauri-api';
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
