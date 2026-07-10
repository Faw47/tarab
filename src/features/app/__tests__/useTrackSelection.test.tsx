import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import type { AlbumDetailsState } from '../app-state-types';
import { useTrackSelection } from '../useTrackSelection';

const makeTrack = (id: string, overrides: Partial<Track> = {}): Track => ({
  id,
  title: overrides.title ?? `Track ${id}`,
  artist: overrides.artist ?? 'Artist',
  album: overrides.album ?? 'Album',
  year: null,
  duration: 180,
  filePath: overrides.filePath ?? `/music/${id}.mp3`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

const libraryTracks = [makeTrack('one'), makeTrack('two')];

const renderSelection = (albumDetails: AlbumDetailsState | null = null) => {
  const navigate = vi.fn();
  const setSearchQuery = vi.fn();
  const hook = renderHook(() =>
    useTrackSelection({
      albumDetails,
      libraryTracks,
      navigate,
      setSearchQuery,
    }),
  );
  return { ...hook, navigate, setSearchQuery };
};

describe('useTrackSelection', () => {
  it('selects, toggles, and clears tracks', () => {
    const { result } = renderSelection();

    act(() => result.current.handleTrackSelect(libraryTracks[0], false));
    expect(result.current.selectedTracks).toEqual([libraryTracks[0]]);

    act(() => result.current.handleTrackSelect(libraryTracks[1], true));
    expect(result.current.selectedTracks).toEqual(libraryTracks);

    act(() => result.current.handleTrackSelect(libraryTracks[0], true));
    expect(result.current.selectedTracks).toEqual([libraryTracks[1]]);

    act(() => result.current.handleClearSelection());
    expect(result.current.selectedTracks).toEqual([]);
  });

  it('selects album tracks before the full library when available', () => {
    const albumTrack = makeTrack('album-one');
    const { result } = renderSelection({
      album: 'Album',
      artist: 'Artist',
      tracks: [albumTrack],
    });

    act(() => result.current.handleSelectAllTracks());

    expect(result.current.selectedTracks).toEqual([albumTrack]);
  });

  it('opens playlist picker with unique track ids and closes context menu', () => {
    const { result } = renderSelection();

    act(() => result.current.handleTrackContextMenu(libraryTracks[0], { x: 10, y: 20 }));
    act(() =>
      result.current.openPlaylistPicker([libraryTracks[0], libraryTracks[0], libraryTracks[1]]),
    );

    expect(result.current.showPlaylistPicker).toBe(true);
    expect(result.current.playlistPickerTrackIds).toEqual(['one', 'two']);
    expect(result.current.contextMenuPosition).toBeNull();
    expect(result.current.contextMenuTrack).toBeNull();

    act(() => result.current.closePlaylistPicker());
    expect(result.current.showPlaylistPicker).toBe(false);
    expect(result.current.playlistPickerTrackIds).toEqual([]);
  });

  it('reveals selected tracks in the library search', () => {
    const { result, navigate, setSearchQuery } = renderSelection();
    const track = makeTrack('needle', { title: 'Needle', artist: 'Haystack' });

    act(() => result.current.handleTrackContextMenu(track, { x: 1, y: 2 }));
    act(() => result.current.handleRevealInLibrary([track]));

    expect(navigate).toHaveBeenCalledWith('library');
    expect(setSearchQuery).toHaveBeenCalledWith('Needle Haystack');
    expect(result.current.selectedTracks).toEqual([track]);
    expect(result.current.contextMenuPosition).toBeNull();
    expect(result.current.contextMenuTrack).toBeNull();
  });
});
