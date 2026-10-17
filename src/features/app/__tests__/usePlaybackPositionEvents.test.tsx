import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import {
  resetPlaybackGenerationForTests,
  setActivePlaybackGeneration,
} from '../playback-generation';
import { usePlaybackPositionEvents } from '../usePlaybackPositionEvents';

const { listeners, listenMock } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
  return {
    listeners,
    listenMock: vi.fn(
      async (eventName: string, handler: (event: { payload: unknown }) => unknown) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    ),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

const initialPlayerState = usePlayerStore.getState();
const scheduleSessionSave = vi.fn();

function Harness() {
  usePlaybackPositionEvents({
    scheduleSessionSave,
    lastSavedPositionRef: { current: 0 },
    lastSessionSaveRef: { current: Date.now() },
  });
  return null;
}

async function renderHarness() {
  render(<Harness />);
  await waitFor(() => {
    expect(listeners.has('playback-position')).toBe(true);
    expect(listeners.has('playback-seeked')).toBe(true);
  });
}

describe('usePlaybackPositionEvents', () => {
  beforeEach(() => {
    listeners.clear();
    scheduleSessionSave.mockClear();
    usePlayerStore.setState(initialPlayerState, true);
    usePlayerStore.setState({ currentTime: 0 });
    resetPlaybackGenerationForTests();
    setActivePlaybackGeneration(3);
  });

  it('stores the numeric position from the Rust position payload', async () => {
    await renderHarness();

    // Shape emitted by `PlaybackPositionEvent` in src-tauri/src/audio/events.rs.
    await listeners.get('playback-position')?.({ payload: { generation: 3, position: 61.5 } });

    expect(usePlayerStore.getState().currentTime).toBe(61.5);
  });

  it('ignores position events from an older playback generation', async () => {
    await renderHarness();

    await listeners.get('playback-position')?.({ payload: { generation: 2, position: 61.5 } });

    expect(usePlayerStore.getState().currentTime).toBe(0);
  });

  it('ignores malformed position payloads', async () => {
    await renderHarness();

    await listeners.get('playback-position')?.({ payload: { generation: 3 } });
    await listeners.get('playback-position')?.({ payload: 'not-a-position' });

    expect(usePlayerStore.getState().currentTime).toBe(0);
  });

  it('applies seek confirmations from the current generation only', async () => {
    await renderHarness();

    await listeners.get('playback-seeked')?.({ payload: { generation: 2, position: 12 } });
    expect(usePlayerStore.getState().currentTime).toBe(0);

    await listeners.get('playback-seeked')?.({ payload: { generation: 3, position: 42 } });
    expect(usePlayerStore.getState().currentTime).toBe(42);
    expect(scheduleSessionSave).toHaveBeenCalledWith(true);
  });
});
