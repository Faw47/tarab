import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../store/player-store';
import { useSessionPersistence } from './useSessionPersistence';

const { savePlayerStateToStoreMock } = vi.hoisted(() => ({
  savePlayerStateToStoreMock: vi.fn(async () => undefined),
}));

vi.mock('../features/app/player-state-store', () => ({
  isPlayerStateHydrated: () => true,
  savePlayerStateToStore: savePlayerStateToStoreMock,
  waitForPlayerStateHydration: async () => undefined,
}));

vi.mock('../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const initialPlayerState = usePlayerStore.getState();
let persistence: ReturnType<typeof useSessionPersistence> | null = null;

function Harness() {
  persistence = useSessionPersistence('home', null);
  return null;
}

describe('useSessionPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    persistence = null;
    usePlayerStore.setState(initialPlayerState, true);
    usePlayerStore.setState({
      currentTrack: {
        id: 'track-1',
        title: 'Track 1',
        artist: 'Artist',
        album: 'Album',
        year: 2024,
        duration: 180,
        filePath: '/music/track-1.mp3',
        hasCoverArt: false,
        coverArtHash: null,
        dateAdded: 1,
      },
      currentTime: 20,
    });
  });

  it('cancels a pending timer and saves the latest snapshot when flushed', async () => {
    render(<Harness />);
    act(() => persistence?.scheduleSessionSave(false));
    usePlayerStore.setState({ currentTime: 57 });

    await act(async () => persistence?.flushSessionSave());
    await act(async () => vi.runAllTimersAsync());

    expect(savePlayerStateToStoreMock).toHaveBeenCalledTimes(1);
    expect(savePlayerStateToStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentTime: 57, currentTrackId: 'track-1' }),
    );
    vi.useRealTimers();
  });

  it('quiesces future scheduled writes before the final quit snapshot', async () => {
    render(<Harness />);

    await act(async () => persistence?.prepareSessionForQuit());
    act(() => persistence?.scheduleSessionSave(true));
    await act(async () => vi.runAllTimersAsync());

    expect(savePlayerStateToStoreMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
