import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import { useCurrentTrackLyrics } from './useCurrentTrackLyrics';

const { getLyricsForTrackMock, playerState, setLyricsMock } = vi.hoisted(() => ({
  getLyricsForTrackMock: vi.fn(),
  playerState: { currentTrack: null as Track | null },
  setLyricsMock: vi.fn(),
}));

vi.mock('../../lib/tauri-commands', () => ({ getLyricsForTrack: getLyricsForTrackMock }));
vi.mock('../../store/player-store', () => ({
  usePlayerStore: (
    selector: (state: typeof playerState & { setLyrics: typeof setLyricsMock }) => unknown,
  ) => selector({ ...playerState, setLyrics: setLyricsMock }),
}));

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: false,
  dateAdded: 0,
});

describe('useCurrentTrackLyrics', () => {
  beforeEach(() => {
    getLyricsForTrackMock.mockReset();
    setLyricsMock.mockReset();
    playerState.currentTrack = null;
  });

  it('clears the previous track lyrics while the next lookup is pending', async () => {
    let resolveFirst: ((value: string | null) => void) | undefined;
    getLyricsForTrackMock.mockImplementation((filePath: string) => {
      if (filePath === '/music/first.mp3') {
        return new Promise<string | null>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve('[00:01.00] New lyrics');
    });

    const firstTrack = makeTrack('first');
    const secondTrack = makeTrack('second');
    playerState.currentTrack = firstTrack;
    const { rerender } = renderHook(({ autoLyrics }) => useCurrentTrackLyrics(autoLyrics), {
      initialProps: { autoLyrics: true },
    });

    await waitFor(() => expect(resolveFirst).toEqual(expect.any(Function)));
    setLyricsMock.mockClear();

    playerState.currentTrack = secondTrack;
    rerender({ autoLyrics: true });

    expect(setLyricsMock).toHaveBeenCalledWith(null);
    await waitFor(() =>
      expect(setLyricsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: expect.arrayContaining([expect.objectContaining({ text: 'New lyrics' })]),
        }),
      ),
    );

    await act(async () => {
      resolveFirst?.('[00:01.00] Old lyrics');
    });

    expect(
      setLyricsMock.mock.calls.some(([lyrics]) =>
        lyrics?.lines?.some((line: { text: string }) => line.text === 'Old lyrics'),
      ),
    ).toBe(false);
  });
});
