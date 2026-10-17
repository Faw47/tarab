import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { usePlayerSessionRestore } from '../usePlayerSessionRestore';

const { dbGetTracksByIdsMock, loadPlayerStateMock, markHydratedMock } = vi.hoisted(() => ({
  dbGetTracksByIdsMock: vi.fn(),
  loadPlayerStateMock: vi.fn(),
  markHydratedMock: vi.fn(),
}));

vi.mock('../../../lib/tauri-commands', () => ({
  dbGetTracksByIds: dbGetTracksByIdsMock,
  dbGetTracksByAlbumArtist: vi.fn(async () => []),
  setPlaybackSpeed: vi.fn(async () => undefined),
  setVolume: vi.fn(async () => undefined),
}));

vi.mock('../player-state-store', () => ({
  loadPlayerStateFromStore: loadPlayerStateMock,
  markPlayerStateHydrated: markHydratedMock,
}));

const dbTrack = (id: string) => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 200,
  filePath: `/music/${id}.flac`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

const session = {
  version: 2,
  revision: 4,
  currentTrackId: 'c',
  queueIds: ['a', 'b', 'c', 'd'],
  queueIndex: 2,
  currentTime: 30,
  playbackSpeed: 1,
  volume: 0.8,
  wasPlaying: false,
  shuffleEnabled: false,
  loopMode: 'all',
  stopAfterCurrent: false,
  lastOpenedAlbum: null,
  lastOpenedArtist: null,
  timestamp: 1,
};

const initialPlayerState = usePlayerStore.getState();
const replaceView = vi.fn();

function Harness() {
  usePlayerSessionRestore({ replaceView });
  return null;
}

describe('usePlayerSessionRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState(initialPlayerState, true);
    loadPlayerStateMock.mockResolvedValue(session);
  });

  it('does not enable saving when the stored queue cannot be resolved', async () => {
    dbGetTracksByIdsMock.mockRejectedValue(new Error('database locked'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<Harness />);

    await waitFor(() => {
      expect(dbGetTracksByIdsMock).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(markHydratedMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queue).toHaveLength(0);
    error.mockRestore();
  });

  it('points the queue index at the restored current track when earlier IDs are missing', async () => {
    dbGetTracksByIdsMock.mockResolvedValue(['b', 'c', 'd'].map(dbTrack));

    render(<Harness />);

    await waitFor(() => {
      expect(markHydratedMock).toHaveBeenCalledTimes(1);
    });
    const state = usePlayerStore.getState();
    expect(state.currentTrack?.id).toBe('c');
    expect(state.queue[state.queueIndex]?.id).toBe('c');
  });

  it('completes hydration under React StrictMode', async () => {
    dbGetTracksByIdsMock.mockResolvedValue(['a', 'b', 'c', 'd'].map(dbTrack));

    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(markHydratedMock).toHaveBeenCalled();
    });
    expect(usePlayerStore.getState().currentTrack?.id).toBe('c');
  });

  it('does not restore again when the effect re-runs after a completed restore', async () => {
    dbGetTracksByIdsMock.mockResolvedValue(['a', 'b', 'c', 'd'].map(dbTrack));
    function Rerendering({ onView }: { onView: () => void }) {
      usePlayerSessionRestore({ replaceView: onView });
      return null;
    }

    const { rerender } = render(<Rerendering onView={vi.fn()} />);
    await waitFor(() => {
      expect(markHydratedMock).toHaveBeenCalledTimes(1);
    });
    usePlayerStore.getState().setQueue([]);

    rerender(<Rerendering onView={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(loadPlayerStateMock).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().queue).toHaveLength(0);
  });

  it('restores the saved position of a duplicated current track', async () => {
    loadPlayerStateMock.mockResolvedValue({
      ...session,
      currentTrackId: 'a',
      queueIds: ['a', 'b', 'a'],
      queueIndex: 2,
    });
    dbGetTracksByIdsMock.mockResolvedValue(['a', 'b'].map(dbTrack));

    render(<Harness />);

    await waitFor(() => {
      expect(markHydratedMock).toHaveBeenCalledTimes(1);
    });
    expect(usePlayerStore.getState().queueIndex).toBe(2);
  });

  it('shifts the saved position when earlier queue entries no longer resolve', async () => {
    loadPlayerStateMock.mockResolvedValue({
      ...session,
      currentTrackId: 'a',
      queueIds: ['x', 'a', 'b', 'a'],
      queueIndex: 3,
    });
    dbGetTracksByIdsMock.mockResolvedValue(['a', 'b'].map(dbTrack));

    render(<Harness />);

    await waitFor(() => {
      expect(markHydratedMock).toHaveBeenCalledTimes(1);
    });
    expect(usePlayerStore.getState().queueIndex).toBe(2);
  });
});
