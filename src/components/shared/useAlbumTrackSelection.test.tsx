import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import { useAlbumTrackSelection } from './useAlbumTrackSelection';

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: false,
  dateAdded: 1,
});

describe('useAlbumTrackSelection', () => {
  it('ignores selected IDs outside the album and scopes bulk targets to album tracks', () => {
    const tracks = [makeTrack('one'), makeTrack('two')];
    const { result } = renderHook(() =>
      useAlbumTrackSelection({
        tracks,
        selectedTrackIds: ['outside-album'],
      }),
    );

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.someSelected).toBe(false);
    expect(result.current.allSelected).toBe(false);
    expect(result.current.selectionActive).toBe(false);
    expect(result.current.targetTracks).toEqual(tracks);
  });

  it('selects all current album tracks and clears when all are already selected', () => {
    const tracks = [makeTrack('one'), makeTrack('two')];
    const onClearSelection = vi.fn();
    const onSelectAll = vi.fn();
    const { result, rerender } = renderHook(
      ({ selectedTrackIds }: { selectedTrackIds: string[] }) =>
        useAlbumTrackSelection({
          tracks,
          selectedTrackIds,
          onClearSelection,
          onSelectAll,
        }),
      { initialProps: { selectedTrackIds: ['one'] } },
    );

    act(() => result.current.handleSelectAll());
    expect(onSelectAll).toHaveBeenCalledWith(tracks);

    rerender({ selectedTrackIds: ['one', 'two', 'outside-album'] });
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.allSelected).toBe(true);
    expect(result.current.targetTracks).toEqual(tracks);

    act(() => result.current.handleSelectAll());
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('supports explicit selection mode before a track is selected', () => {
    const tracks = [makeTrack('one')];
    const { result } = renderHook(() =>
      useAlbumTrackSelection({
        tracks,
        selectedTrackIds: [],
      }),
    );

    act(() => result.current.activateSelection());

    expect(result.current.selectionActive).toBe(true);
  });
});
