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

  it('keeps the selection anchor attached to its track when the visible order changes', () => {
    const onSelectionChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ filteredTracks }: { filteredTracks: Track[] }) =>
        useTagManagerSelection({
          filteredTracks,
          selectedTracks: [],
          onSelectionChange,
          onToggleTrack: vi.fn(),
          onEscape: vi.fn(),
        }),
      { initialProps: { filteredTracks: tracks } },
    );

    act(() => {
      result.current.handleRowClick(
        tracks[1],
        { metaKey: false, ctrlKey: false, shiftKey: false } as MouseEvent,
        1,
      );
    });

    const reorderedTracks = [tracks[0], tracks[2], tracks[1], tracks[3]];
    rerender({ filteredTracks: reorderedTracks });

    act(() => {
      result.current.handleRowClick(
        tracks[3],
        { metaKey: false, ctrlKey: false, shiftKey: true } as MouseEvent,
        3,
      );
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith([tracks[1], tracks[3]]);
  });

  it('only reports all visible tracks selected and preserves hidden selection when clearing them', () => {
    const onSelectionChange = vi.fn();
    const visibleTracks = tracks.slice(1, 3);
    const hiddenTrack = tracks[0];
    const { result } = renderHook(() =>
      useTagManagerSelection({
        filteredTracks: visibleTracks,
        selectedTracks: [hiddenTrack, visibleTracks[0], visibleTracks[1]],
        onSelectionChange,
        onToggleTrack: vi.fn(),
        onEscape: vi.fn(),
      }),
    );

    expect(result.current.allSelected).toBe(true);

    act(() => {
      result.current.handleToggleAll();
    });

    expect(onSelectionChange).toHaveBeenCalledWith([hiddenTrack]);
  });

  it('does not treat a hidden selection as selecting every visible track', () => {
    const { result } = renderHook(() =>
      useTagManagerSelection({
        filteredTracks: tracks.slice(1, 3),
        selectedTracks: [tracks[0], tracks[1]],
        onSelectionChange: vi.fn(),
        onToggleTrack: vi.fn(),
        onEscape: vi.fn(),
      }),
    );

    expect(result.current.allSelected).toBe(false);
  });

  it('blocks bulk selection until the full-library snapshot is ready', () => {
    const onSelectionChange = vi.fn();
    const preventDefault = vi.fn();
    const { result } = renderHook(() =>
      useTagManagerSelection({
        filteredTracks: tracks,
        selectedTracks: [],
        onSelectionChange,
        onToggleTrack: vi.fn(),
        onEscape: vi.fn(),
        allowSelectAll: false,
      }),
    );

    act(() => {
      result.current.handleToggleAll();
      result.current.handleTableKeyDown({
        key: 'a',
        ctrlKey: true,
        metaKey: false,
        preventDefault,
      } as unknown as KeyboardEvent);
    });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('recovers an externally seeded anchor from the previous visible order', () => {
    const onSelectionChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ filteredTracks }: { filteredTracks: Track[] }) =>
        useTagManagerSelection({
          filteredTracks,
          selectedTracks: [],
          onSelectionChange,
          onToggleTrack: vi.fn(),
          onEscape: vi.fn(),
        }),
      { initialProps: { filteredTracks: tracks } },
    );

    act(() => {
      result.current.setSelectionAnchor(1);
    });
    rerender({ filteredTracks: [tracks[0], tracks[2], tracks[1], tracks[3]] });

    act(() => {
      result.current.handleRowClick(
        tracks[3],
        { metaKey: false, ctrlKey: false, shiftKey: true } as MouseEvent,
        3,
      );
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith([tracks[1], tracks[3]]);
  });

  it('keeps keyboard focus attached to the same track when filtering reorders the list', () => {
    const { result, rerender } = renderHook(
      ({ filteredTracks }: { filteredTracks: Track[] }) =>
        useTagManagerSelection({
          filteredTracks,
          selectedTracks: [],
          onSelectionChange: vi.fn(),
          onToggleTrack: vi.fn(),
          onEscape: vi.fn(),
        }),
      { initialProps: { filteredTracks: tracks } },
    );

    act(() => result.current.setFocusedIndex(1));
    rerender({ filteredTracks: [tracks[0], tracks[2], tracks[1], tracks[3]] });

    expect(result.current.focusedIndex).toBe(2);
  });

  it('closes transient surfaces on Escape when no tracks are visible', () => {
    const onSelectionChange = vi.fn();
    const onEscape = vi.fn();
    const { result } = renderHook(() =>
      useTagManagerSelection({
        filteredTracks: [],
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
