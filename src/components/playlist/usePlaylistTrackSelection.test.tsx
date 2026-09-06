import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PlaylistEntry } from '../../types';
import { usePlaylistTrackSelection } from './usePlaylistTrackSelection';

const entries: PlaylistEntry[] = [0, 1, 2].map((index) => ({
  trackId: 'track-' + index,
  position: index,
  title: 'Track ' + index,
  artist: 'Artist',
  album: 'Album',
  duration: 180,
  available: true,
  filePath: '/music/track-' + index + '.mp3',
  hasCoverArt: false,
  coverArtHash: null,
}));

const keyEvent = (
  key: string,
  options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): KeyboardEvent =>
  ({
    key,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
  }) as unknown as KeyboardEvent;

const clickEvent = (shiftKey = false): MouseEvent<HTMLInputElement> =>
  ({
    shiftKey,
    preventDefault: vi.fn(),
  }) as unknown as MouseEvent<HTMLInputElement>;

function useSelectionHarness(
  onPlayEntry: (entry: PlaylistEntry) => void,
  onRemoveSelected: (trackIds: string[]) => void,
) {
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const selection = usePlaylistTrackSelection({
    entries,
    resetKey: 'playlist-1',
    selectedTrackIds,
    onSelectionChange: setSelectedTrackIds,
    onPlayEntry,
    onRemoveSelected,
  });
  return { ...selection, selectedTrackIds };
}

describe('usePlaylistTrackSelection', () => {
  it('moves focus with arrows and extends a selection with Shift+arrow', () => {
    const onPlayEntry = vi.fn();
    const onRemoveSelected = vi.fn();
    const { result } = renderHook(() => useSelectionHarness(onPlayEntry, onRemoveSelected));

    act(() => {
      result.current.handleListKeyDown(keyEvent('ArrowDown'));
    });
    expect(result.current.focusedIndex).toBe(1);

    act(() => {
      result.current.handleListKeyDown(keyEvent('ArrowUp', { shiftKey: true }));
    });

    expect(result.current.focusedIndex).toBe(0);
    expect([...result.current.selectedTrackIds]).toEqual(['track-0', 'track-1']);
  });

  it('extends selection from the anchor with Shift+click', () => {
    const { result } = renderHook(() => useSelectionHarness(vi.fn(), vi.fn()));

    act(() => {
      result.current.handleEntryToggle(0, clickEvent());
      result.current.handleEntryToggle(2, clickEvent(true));
    });

    expect([...result.current.selectedTrackIds]).toEqual(['track-0', 'track-1', 'track-2']);
    expect(result.current.focusedIndex).toBe(2);
  });

  it('selects visible entries with Ctrl+A and removes them with Delete', () => {
    const onRemoveSelected = vi.fn();
    const { result } = renderHook(() => useSelectionHarness(vi.fn(), onRemoveSelected));

    act(() => {
      result.current.handleListKeyDown(keyEvent('a', { ctrlKey: true }));
    });
    expect([...result.current.selectedTrackIds]).toEqual(['track-0', 'track-1', 'track-2']);

    act(() => {
      result.current.handleListKeyDown(keyEvent('Delete'));
    });
    expect(onRemoveSelected).toHaveBeenCalledWith(['track-0', 'track-1', 'track-2']);
  });

  it('plays the focused available entry with Enter', () => {
    const onPlayEntry = vi.fn();
    const { result } = renderHook(() => useSelectionHarness(onPlayEntry, vi.fn()));

    act(() => {
      result.current.handleListKeyDown(keyEvent('ArrowDown'));
      result.current.handleListKeyDown(keyEvent('Enter'));
    });

    expect(onPlayEntry).toHaveBeenCalledWith(entries[1]);
  });

  it('does not consume list shortcuts from the playlist search field', () => {
    const onRemoveSelected = vi.fn();
    const { result } = renderHook(() => useSelectionHarness(vi.fn(), onRemoveSelected));
    const searchInput = document.createElement('input');
    const event = {
      ...keyEvent('Delete'),
      target: searchInput,
    } as unknown as KeyboardEvent;

    act(() => {
      result.current.handleListKeyDown(event);
    });

    expect(onRemoveSelected).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
