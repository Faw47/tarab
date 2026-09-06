import { useCallback, useState } from 'react';
import type { ConfirmDialogProps } from '../../components/ui/ConfirmDialog';
import type { Track } from '../../types';

export type ConfirmDialogState = Omit<ConfirmDialogProps, 'onCancel'>;

interface UseDialogManagerOptions {
  onCloseContextMenu?: () => void;
}

export function useDialogManager({ onCloseContextMenu }: UseDialogManagerOptions = {}) {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [tagEditorTracks, setTagEditorTracks] = useState<Track[] | null>(null);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [playlistPickerTrackIds, setPlaylistPickerTrackIds] = useState<string[]>([]);

  const openTagEditor = useCallback((tracks: Track[]) => {
    if (tracks.length > 0) setTagEditorTracks(tracks);
  }, []);

  const closeTagEditor = useCallback(() => {
    setTagEditorTracks(null);
  }, []);

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  const openPlaylistPicker = useCallback(
    (tracks: Track[]) => {
      const trackIds = Array.from(new Set(tracks.map((track) => track.id))).filter(Boolean);
      if (trackIds.length === 0) return;
      setPlaylistPickerTrackIds(trackIds);
      setShowPlaylistPicker(true);
      onCloseContextMenu?.();
    },
    [onCloseContextMenu],
  );

  const closePlaylistPicker = useCallback(() => {
    setShowPlaylistPicker(false);
    setPlaylistPickerTrackIds([]);
  }, []);

  return {
    confirmDialog,
    setConfirmDialog,
    closeConfirmDialog,
    tagEditorTracks,
    setTagEditorTracks,
    openTagEditor,
    closeTagEditor,
    showPlaylistPicker,
    playlistPickerTrackIds,
    openPlaylistPicker,
    closePlaylistPicker,
  };
}
