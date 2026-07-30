import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import { useTagManagerSelection } from './useTagManagerSelection';

const tracks = Array.from({ length: 4 }, (_, index) => ({
  id: `track-${index}`,
  title: `Track ${index}`,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: `/music/track-${index}.mp3`,
  dateAdded: index,
  playCount: 0,
  hasCoverArt: false,
})) satisfies Track[];

describe('useTagManagerSelection', () => {
  it('selects a contiguous range from the selection anchor', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderHook(() =>
      useTagManagerSelection({
        filteredTracks: tracks,
        selectedTracks: [],
        onSelectionChange,
        onToggleTrack: vi.fn(),
        onEscape: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleRowClick(
        tracks[1],
        { metaKey: false, ctrlKey: false, shiftKey: false } as MouseEvent,
        1,
      );
      result.current.handleRowClick(
        tracks[3],
        { metaKey: false, ctrlKey: false, shiftKey: true } as MouseEvent,
        3,
      );
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(tracks.slice(1, 4));
  });

  it('clears selection and closes transient surfaces on Escape', () => {
    const onSelectionChange = vi.fn();
    const onEscape = vi.fn();
    const { result } = renderHook(() =>
      useTagManagerSelection({
        filteredTracks: tracks,
        selectedTracks: [tracks[0]],
        onSelectionChange,
        onToggleTrack: vi.fn(),
        onEscape,
      }),
    );

    act(() => {
      result.current.handleTableKeyDown({ key: 'Escape' } as KeyboardEvent);
    });

    expect(onEscape).toHaveBeenCalledOnce();
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });
});
