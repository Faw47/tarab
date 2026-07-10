import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

vi.mock('../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn(async () => undefined),
}));

afterEach(() => {
  cleanup();
});

if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
