import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../types';
import { useContextMenuBuilder } from './useContextMenuBuilder';

const makeTrack = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

const selectedTracks = [makeTrack('one'), makeTrack('two')];

function renderMenu(contextMenuTrack: Track) {
  const callbacks = {
    addToQueue: vi.fn(),
    setTagEditorTracks: vi.fn(),
    handleRevealTracks: vi.fn(),
    handleRemoveTracks: vi.fn(),
    handleRevealInLibrary: vi.fn(),
    applyTrackRatings: vi.fn(),
    openPlaylistPicker: vi.fn(),
  };
  const queryClient = new QueryClient();
  const hook = renderHook(() =>
    useContextMenuBuilder({
      selectedTracks,
      contextMenuTrack,
      queryClient,
      ...callbacks,
    }),
  );

  const item = (id: string) => {
    const match = hook.result.current.contextMenuItems.find((entry) => entry.id === id);
    if (!match) throw new Error(`Missing context menu item: ${id}`);
    return match;
  };

  return { ...hook, callbacks, item };
}

describe('useContextMenuBuilder', () => {
  it('uses the multi-selection when the context track belongs to it', () => {
    const { callbacks, item } = renderMenu(selectedTracks[0]);

    act(() => item('queue').onClick());
    act(() => item('edit').onClick());

    expect(callbacks.addToQueue.mock.calls).toEqual([
      [selectedTracks[0], 'last'],
      [selectedTracks[1], 'last'],
    ]);
    expect(item('edit').label).toBe('Edit 2 Tracks');
    expect(callbacks.setTagEditorTracks).toHaveBeenCalledWith(selectedTracks);
  });

  it('targets only an unrelated right-clicked track', () => {
    const contextTrack = makeTrack('context');
    const { callbacks, item } = renderMenu(contextTrack);

    act(() => item('queue').onClick());
    act(() => item('edit').onClick());
    act(() => item('remove').onClick());

    expect(callbacks.addToQueue).toHaveBeenCalledOnce();
    expect(callbacks.addToQueue).toHaveBeenCalledWith(contextTrack, 'last');
    expect(item('edit').label).toBe('Edit Info');
    expect(callbacks.setTagEditorTracks).toHaveBeenCalledWith([contextTrack]);
    expect(callbacks.handleRemoveTracks).toHaveBeenCalledWith([contextTrack]);
  });
});
