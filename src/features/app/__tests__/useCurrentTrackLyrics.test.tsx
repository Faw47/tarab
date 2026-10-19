import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurrentTrackLyrics } from '../useCurrentTrackLyrics';

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  getLyrics: vi.fn(),
  setLyrics: vi.fn(),
  track: {
    filePath: '/music/song.mp3',
    artist: 'Artist',
    title: 'Song',
    album: 'Album',
    duration: 60,
  },
}));
vi.mock('../../../store/player-store', () => ({
  usePlayerStore: (select: (state: unknown) => unknown) =>
    select({ currentTrack: mocks.track, setLyrics: mocks.setLyrics }),
}));
vi.mock('../../../platform/tauri-zustand-storage', () => ({ flushSettingsWrites: mocks.flush }));
vi.mock('../../../lib/tauri-commands', () => ({ getLyricsForTrack: mocks.getLyrics }));
vi.mock('../../../lib/report-error', () => ({ reportError: vi.fn() }));

describe('online lyrics consent persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flush.mockResolvedValue(undefined);
    mocks.getLyrics.mockResolvedValue(null);
  });

  it('waits for the pending consent save before requesting online lyrics', async () => {
    let finish: () => void = () => undefined;
    mocks.flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(() => useCurrentTrackLyrics(true));
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(mocks.getLyrics).not.toHaveBeenCalled();
    await act(async () => {
      finish();
    });
    await waitFor(() =>
      expect(mocks.getLyrics).toHaveBeenCalledWith(
        '/music/song.mp3',
        true,
        'Artist',
        'Song',
        'Album',
        60,
      ),
    );
  });

  it('cancels a waiting online request when consent is disabled', async () => {
    let finish: () => void = () => undefined;
    mocks.flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = renderHook(({ enabled }) => useCurrentTrackLyrics(enabled), {
      initialProps: { enabled: true },
    });
    rerender({ enabled: false });
    await act(async () => {
      finish();
    });
    expect(mocks.getLyrics).toHaveBeenCalledTimes(1);
    expect(mocks.getLyrics.mock.calls[0][1]).toBe(false);
  });

  it('loads local lyrics without waiting for settings writes when online lookup is off', async () => {
    renderHook(() => useCurrentTrackLyrics(false));
    await waitFor(() => expect(mocks.getLyrics).toHaveBeenCalledOnce());
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.getLyrics.mock.calls[0][1]).toBe(false);
  });
});
