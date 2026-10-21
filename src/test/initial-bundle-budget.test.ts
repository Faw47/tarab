import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = join(repoRoot, 'scripts/check-initial-bundle.mjs');

function createBundleFixture(options: {
  mainBytes?: number;
  miniPlayerBytes?: number;
  threeBytes?: number;
}) {
  const root = mkdtempSync(join(tmpdir(), 'tarab-bundle-budget-'));
  const dist = join(root, 'dist');
  const assets = join(dist, 'assets');
  mkdirSync(assets, { recursive: true });
  mkdirSync(join(dist, '.vite'), { recursive: true });

  const writeAsset = (name: string, bytes: number) => {
    writeFileSync(join(assets, name), Buffer.alloc(bytes, 97));
  };
  writeAsset('main.js', options.mainBytes ?? 128);
  writeAsset('mini-player.js', options.miniPlayerBytes ?? 128);
  writeAsset('shared.js', 64);
  writeAsset('three-stack.js', options.threeBytes ?? 0);

  const manifest = {
    'src/main.tsx': {
      file: 'assets/main.js',
      isEntry: true,
      src: 'src/main.tsx',
      imports: ['src/shared.ts'],
      dynamicImports: ['src/three-stack.ts'],
    },
    'src/mini-player.tsx': {
      file: 'assets/mini-player.js',
      isEntry: true,
      src: 'src/mini-player.tsx',
      imports: ['src/shared.ts'],
    },
    'src/shared.ts': { file: 'assets/shared.js' },
    'src/three-stack.ts': { file: 'assets/three-stack.js' },
  };
  writeFileSync(join(dist, '.vite', 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><html></html>');
  writeFileSync(join(dist, 'mini-player.html'), '<!doctype html><html></html>');

  return root;
}

function runBundleCheck(cwd: string) {
  return spawnSync(process.execPath, [scriptPath], { cwd, encoding: 'utf8' });
}

describe('initial bundle budget', () => {
  it('rejects a main entry whose static graph exceeds its raw byte budget', () => {
    const root = createBundleFixture({ mainBytes: 1_100_001 });

    try {
      const result = runBundleCheck(root);
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stdout + '\n' + result.stderr).toMatch(/main.*budget|budget.*main/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('measures only eagerly loaded modules, excluding a large lazy Three.js chunk', () => {
    const root = createBundleFixture({ threeBytes: 1_300_000 });

    try {
      const result = runBundleCheck(root);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('main');
      expect(result.stdout).toContain('mini-player');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces the mini-player budget separately', () => {
    const root = createBundleFixture({ miniPlayerBytes: 500_001 });

    try {
      const result = runBundleCheck(root);
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stdout + '\n' + result.stderr).toMatch(
        /mini-player.*budget|budget.*mini-player/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
