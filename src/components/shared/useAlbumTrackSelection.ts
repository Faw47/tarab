import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Track } from '../../types';

interface AlbumTrackSelectionOptions {
  tracks: Track[];
  selectedTrackIds: string[];
  onClearSelection?: () => void;
  onSelectAll?: (tracks: Track[]) => void;
}

export function useAlbumTrackSelection({
  tracks,
  selectedTrackIds,
  onClearSelection,
  onSelectAll,
}: AlbumTrackSelectionOptions) {
  const [manualSelectionMode, setManualSelectionMode] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds]);
  const selectedTracks = useMemo(
    () => tracks.filter((track) => selectedSet.has(track.id)),
    [tracks, selectedSet],
  );
  const selectedCount = selectedTracks.length;
  const someSelected = selectedCount > 0;
  const allSelected = tracks.length > 0 && selectedCount === tracks.length;
  const selectionActive = manualSelectionMode || someSelected;
  const targetTracks = selectedTracks.length > 0 ? selectedTracks : tracks;

  useEffect(() => {
    if (!someSelected) setManualSelectionMode(false);
  }, [someSelected]);

  const activateSelection = useCallback(() => setManualSelectionMode(true), []);

  const clearSelection = useCallback(() => {
    setManualSelectionMode(false);
    onClearSelection?.();
  }, [onClearSelection]);

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
      return;
    }
    onSelectAll?.(tracks);
  }, [allSelected, clearSelection, onSelectAll, tracks]);

  return {
    selectedSet,
    selectedTracks,
    selectedCount,
    someSelected,
    allSelected,
    selectionActive,
    targetTracks,
    activateSelection,
    clearSelection,
    handleSelectAll,
  };
}
