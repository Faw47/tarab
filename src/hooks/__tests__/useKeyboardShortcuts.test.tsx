import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

const mocks = vi.hoisted(() => ({
  stepVolume: vi.fn(async () => undefined),
  toggleMute: vi.fn(async () => undefined),
}));

vi.mock('../../lib/volume', () => mocks);
vi.mock('../../lib/playback-actions', () => ({
  playAdjacentTrack: vi.fn(async () => undefined),
  toggleCurrentPlayback: vi.fn(async () => undefined),
}));
vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));
vi.mock('../../store/player-store', () => ({
  usePlayerStore: { getState: () => ({ currentTrack: null }) },
}));

function KeyboardShortcutsHarness() {
  useKeyboardShortcuts({
    setContextMenuPosition: vi.fn(),
    setShowFullPlayer: vi.fn(),
    setSelectedTracks: vi.fn(),
    contextMenuPosition: null,
    showFullPlayer: false,
    selectedTracks: [],
  });
  return <div>Keyboard shortcuts test</div>;
}

describe('useKeyboardShortcuts volume keys (FE-36)', () => {
  it('leaves plain Up and Down for normal navigation instead of changing volume', () => {
    render(<KeyboardShortcutsHarness />);
    mocks.stepVolume.mockClear();

    fireEvent.keyDown(window, { code: 'ArrowUp', key: 'ArrowUp' });
    fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown' });

    expect(mocks.stepVolume).not.toHaveBeenCalled();
  });
});
