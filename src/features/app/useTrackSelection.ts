import { useCallback, useState } from 'react';
import type { NavView } from '../../components/navigation';
import type { ContextMenuPosition, Track } from '../../types';
import type { AlbumDetailsState } from './app-state-types';

interface UseTrackSelectionOptions {
  albumDetails: AlbumDetailsState | null;
  libraryTracks: Track[];
  navigate: (view: NavView) => void;
  setSearchQuery: (query: string) => void;
}

export function useTrackSelection({
  albumDetails,
  libraryTracks,
  navigate,
  setSearchQuery,
}: UseTrackSelectionOptions) {
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition | null>(null);
  const [contextMenuTrack, setContextMenuTrack] = useState<Track | null>(null);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [playlistPickerTrackIds, setPlaylistPickerTrackIds] = useState<string[]>([]);

  const closeContextMenu = useCallback(() => {
    setContextMenuPosition(null);
    setContextMenuTrack(null);
  }, []);

  const handleTrackContextMenu = useCallback((track: Track, position: ContextMenuPosition) => {
    setContextMenuTrack(track);
    setContextMenuPosition(position);
  }, []);

  const handleTrackSelect = useCallback((track: Track, isMulti: boolean) => {
    if (!isMulti) {
      setSelectedTracks([track]);
      return;
    }

    setSelectedTracks((prev) => {
      const isSelected = prev.some((t) => t.id === track.id);
      return isSelected ? prev.filter((t) => t.id !== track.id) : [...prev, track];
    });
  }, []);

  const handleSelectAllTracks = useCallback(() => {
    setSelectedTracks(albumDetails?.tracks.length ? albumDetails.tracks : libraryTracks);
  }, [albumDetails, libraryTracks]);

  const handleClearSelection = useCallback(() => {
    setSelectedTracks([]);
  }, []);

  const handleSelectionChange = useCallback((tracks: Track[]) => {
    setSelectedTracks(tracks);
  }, []);

  const openPlaylistPicker = useCallback(
    (tracks: Track[]) => {
      const trackIds = Array.from(new Set(tracks.map((track) => track.id))).filter(Boolean);
      if (trackIds.length === 0) return;
      setPlaylistPickerTrackIds(trackIds);
      setShowPlaylistPicker(true);
      closeContextMenu();
    },
    [closeContextMenu],
  );

  const closePlaylistPicker = useCallback(() => {
    setShowPlaylistPicker(false);
    setPlaylistPickerTrackIds([]);
  }, []);

  const handleRevealInLibrary = useCallback(
    (tracks: Track[]) => {
      const first = tracks[0];
      if (!first) return;
      const revealQuery = [first.title, first.artist].filter(Boolean).join(' ').trim();
      navigate('library');
      setSelectedTracks(tracks);
      setSearchQuery(revealQuery);
      closeContextMenu();
    },
    [closeContextMenu, navigate, setSearchQuery],
  );

  return {
    selectedTracks,
    setSelectedTracks,
    contextMenuPosition,
    setContextMenuPosition,
    contextMenuTrack,
    setContextMenuTrack,
    showPlaylistPicker,
    playlistPickerTrackIds,
    handleTrackContextMenu,
    handleTrackSelect,
    handleSelectAllTracks,
    handleClearSelection,
    handleSelectionChange,
    openPlaylistPicker,
    closePlaylistPicker,
    closeContextMenu,
    handleRevealInLibrary,
  };
}
