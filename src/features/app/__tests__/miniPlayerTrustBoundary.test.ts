import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readWorkspaceFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('mini-player trust boundary', () => {
  it('does not grant the mini renderer event emission capability', () => {
    const capability = JSON.parse(readWorkspaceFile('src-tauri/capabilities/core-mini.json')) as {
      permissions: string[];
    };

    expect(capability.permissions).toContain('core:event:allow-listen');
    expect(capability.permissions).not.toContain('core:event:allow-emit');
    expect(capability.permissions).not.toContain('core:event:allow-emit-to');
  });

  it('uses native commands instead of renderer event emission', () => {
    const surface = readWorkspaceFile('src/components/player/DesktopMiniWindowSurface.tsx');

    expect(surface).toContain('desktopMiniControl');
    expect(surface).toContain('desktopMiniSeek');
    expect(surface).toContain('desktopMiniRequestSnapshot');
    expect(surface).not.toContain("from '@tauri-apps/api/event'");
    expect(surface).not.toContain('emitTo(');
  });

  it('does not mount the persistent main-window provider in the mini entry', () => {
    const entry = readWorkspaceFile('src/mini-player.tsx');

    expect(entry).not.toContain('AppProviders');
    expect(entry).toContain('<DesktopMiniWindowSurface />');
  });
});
