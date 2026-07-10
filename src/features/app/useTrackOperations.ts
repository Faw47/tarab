import type { QueryClient } from '@tanstack/react-query';
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import type { ConfirmDialogProps } from '../../components/ui/ConfirmDialog';
import { reportError } from '../../lib/report-error';
import {
  dbDeleteTracks,
  dbGetTrackCount,
  deleteFiles,
  getCoverArtData,
  moveFile,
  pausePlayback,
  readFullTags,
  renameFile,
  stopPlayback,
  writeTagsBatch,
} from '../../lib/tauri-commands';
import { refreshTracksByFilePaths } from '../../lib/track-refresh';
import { useMetadataClipboardStore } from '../../store/metadata-clipboard-store';
import { resolveActiveQueueIndex, usePlayerStore } from '../../store/player-store';
import type { ContextMenuPosition, TagUpdate, Track } from '../../types';
import { invalidateLibraryForMutation } from '../library/mutations';
import { libraryKeys } from '../library/queryKeys';
import { playlistKeys } from '../playlists/queryKeys';
import type { AlbumDetailsState } from './app-state-types';

type SetConfirmDialog = Dispatch<SetStateAction<Omit<ConfirmDialogProps, 'onCancel'> | null>>;

interface UseTrackOperationsParams {
  queryClient: QueryClient;
  libraryTracks: Track[];
  albumDetails: AlbumDetailsState | null;
  setAlbumDetails: (details: AlbumDetailsState | null) => void;
  setTracks: (tracks: Track[]) => void;
  setTrackCount: (count: number) => void;
  setSelectedTracks: Dispatch<SetStateAction<Track[]>>;
  setTagEditorTracks: Dispatch<SetStateAction<Track[] | null>>;
  setContextMenuTrack: Dispatch<SetStateAction<Track | null>>;
  setContextMenuPosition: Dispatch<SetStateAction<ContextMenuPosition | null>>;
  setConfirmDialog: SetConfirmDialog;
  handleClearSelection: () => void;
}

export function useTrackOperations({
  queryClient,
  libraryTracks,
  albumDetails,
  setAlbumDetails,
  setTracks,
  setTrackCount,
  setSelectedTracks,
  setTagEditorTracks,
  setContextMenuTrack,
  setContextMenuPosition,
  setConfirmDialog,
  handleClearSelection,
}: UseTrackOperationsParams) {
  const metadataClipboard = useMetadataClipboardStore();

  const handleCopyMetadata = useCallback(
    async (track: Track) => {
      try {
        const info = await readFullTags(track.filePath);
        const update = metadataClipboard.buildTagUpdateFromInfo(info);
        let coverArt = null;
        try {
          const art = await getCoverArtData(track.filePath);
          if (art) {
            coverArt = { mime: art[0], base64: art[1] };
          }
        } catch (err) {
          console.warn('Cover art copy failed:', err);
        }
        metadataClipboard.setClipboard(update, coverArt, track.filePath);
      } catch (err) {
        reportError('Failed to copy metadata', { source: 'app', error: err });
      }
    },
    [metadataClipboard],
  );

  const handlePasteMetadata = useCallback(
    async (targets: Track[]) => {
      if (!metadataClipboard.canPaste() || !metadataClipboard.data) return;
      try {
        const payload: TagUpdate = { ...metadataClipboard.data };
        if (metadataClipboard.coverArt) {
          payload.coverArtBase64 = metadataClipboard.coverArt.base64;
          payload.coverArtMime = metadataClipboard.coverArt.mime;
        }
        const filePaths = targets.map((t) => t.filePath);
        await writeTagsBatch(filePaths, payload);
        await refreshTracksByFilePaths(filePaths);
      } catch (err) {
        reportError('Failed to paste metadata', { source: 'app', error: err });
      }
    },
    [metadataClipboard],
  );

  const applyTrackPathUpdates = useCallback(
    (replacements: Record<string, string>) => {
      const map = new Map(Object.entries(replacements));
      if (map.size === 0) return;

      const updateTrackPath = (track: Track): Track => {
        const newPath = map.get(track.filePath);
        return newPath ? { ...track, id: newPath, filePath: newPath } : track;
      };

      const currentTracks =
        queryClient.getQueryData<Track[]>(libraryKeys.tracks()) ?? libraryTracks;
      const updatedTracks = currentTracks.map(updateTrackPath);
      setTracks(updatedTracks);

      setSelectedTracks((previous) => previous.map(updateTrackPath));

      setTagEditorTracks((previous) => (previous ? previous.map(updateTrackPath) : null));

      setContextMenuTrack((previous) => {
        if (!previous) return previous;
        return updateTrackPath(previous);
      });

      if (albumDetails) {
        setAlbumDetails({
          ...albumDetails,
          tracks: albumDetails.tracks.map(updateTrackPath),
        });
      }

      const player = usePlayerStore.getState();
      player.setQueue(player.queue.map(updateTrackPath));

      if (player.currentTrack) {
        const updatedCurrentTrack = updateTrackPath(player.currentTrack);
        if (updatedCurrentTrack !== player.currentTrack)
          player.setCurrentTrack(updatedCurrentTrack);
      }

      void queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
    [
      albumDetails,
      libraryTracks,
      queryClient,
      setAlbumDetails,
      setContextMenuTrack,
      setSelectedTracks,
      setTagEditorTracks,
      setTracks,
    ],
  );

  const applyTrackRatings = useCallback(
    (trackIds: string[], rating: number | null) => {
      if (trackIds.length === 0) return;
      const targetIds = new Set(trackIds);
      const currentTracks =
        queryClient.getQueryData<Track[]>(libraryKeys.tracks()) ?? libraryTracks;

      setTracks(
        currentTracks.map((track) => (targetIds.has(track.id) ? { ...track, rating } : track)),
      );

      setSelectedTracks((previous) =>
        previous.map((track) => (targetIds.has(track.id) ? { ...track, rating } : track)),
      );
      setContextMenuTrack((previous) => (previous && targetIds.has(previous.id) ? null : previous));
      usePlayerStore.getState().applyTrackRatings(trackIds, rating);
    },
    [libraryTracks, queryClient, setContextMenuTrack, setSelectedTracks, setTracks],
  );

  const pruneTracks = useCallback(
    async (tracksToRemove: Track[]) => {
      if (!tracksToRemove || tracksToRemove.length === 0) return;
      const ids = new Set(tracksToRemove.map((track) => track.id));
      setTracks(libraryTracks.filter((track) => !ids.has(track.id)));

      const player = usePlayerStore.getState();
      const filteredQueue = player.queue.filter((track) => !ids.has(track.id));
      const currentTrackRemoved = Boolean(player.currentTrack && ids.has(player.currentTrack.id));
      const nextQueueIndex = filteredQueue.length
        ? currentTrackRemoved
          ? Math.min(player.queueIndex, filteredQueue.length - 1)
          : resolveActiveQueueIndex(filteredQueue, player.queueIndex, player.currentTrack)
        : -1;
      player.setQueue(filteredQueue);
      player.setQueueIndex(nextQueueIndex);

      if (currentTrackRemoved) {
        try {
          await pausePlayback();
          await stopPlayback();
        } catch (err) {
          reportError('Failed to stop playback before removal', { source: 'app', error: err });
        }
        player.setCurrentTrack(null);
        player.setIsPlaying(false);
        player.setCurrentTime(0);
        player.setHasActivePlayback(false);
      }

      setSelectedTracks((previous) => previous.filter((track) => !ids.has(track.id)));
      setContextMenuTrack((previous) => (previous && ids.has(previous.id) ? null : previous));
      setContextMenuPosition(null);
      void queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
    [
      libraryTracks,
      queryClient,
      setContextMenuPosition,
      setContextMenuTrack,
      setSelectedTracks,
      setTracks,
    ],
  );

  const handleRemoveTracks = useCallback(
    (tracksToRemove: Track[], options?: { updateAlbumView?: boolean }) => {
      if (tracksToRemove.length === 0) return;
      const confirmMsg =
        tracksToRemove.length === 1
          ? `Remove "${tracksToRemove[0].title}" from your library?`
          : `Remove ${tracksToRemove.length} tracks from your library?`;

      setConfirmDialog({
        title: 'Remove from library',
        message: confirmMsg,
        variant: 'danger',
        confirmLabel: 'Remove',
        onConfirm: async () => {
          try {
            await dbDeleteTracks(tracksToRemove.map((track) => track.id));
            await pruneTracks(tracksToRemove);
            const total = await dbGetTrackCount();
            setTrackCount(total);
            await invalidateLibraryForMutation(queryClient, 'delete');

            if (options?.updateAlbumView && albumDetails) {
              const ids = new Set(tracksToRemove.map((track) => track.id));
              const remainingTracks = albumDetails.tracks.filter((track) => !ids.has(track.id));
              if (remainingTracks.length > 0) {
                setAlbumDetails({ ...albumDetails, tracks: remainingTracks });
              } else {
                setAlbumDetails(null);
              }
              handleClearSelection();
            }
          } catch (err) {
            reportError(
              options?.updateAlbumView
                ? 'Failed to remove tracks from album'
                : 'Failed to remove tracks from library',
              { source: 'app', error: err },
            );
          }
        },
      });
    },
    [
      albumDetails,
      handleClearSelection,
      pruneTracks,
      queryClient,
      setAlbumDetails,
      setConfirmDialog,
      setTrackCount,
    ],
  );

  const handleDeleteFiles = useCallback(
    (tracksToDelete: Track[]) => {
      if (!tracksToDelete || tracksToDelete.length === 0) return;
      const first = tracksToDelete[0];
      const message =
        tracksToDelete.length === 1
          ? `Delete "${first.title}" from disk? This cannot be undone.`
          : `Delete ${tracksToDelete.length} files from disk? This cannot be undone.`;
      const detail = tracksToDelete.length === 1 ? first.filePath : undefined;

      setConfirmDialog({
        title: 'Delete files',
        message,
        detail,
        variant: 'danger',
        confirmLabel: 'Delete',
        onConfirm: async () => {
          const filePaths = tracksToDelete.map((track) => track.filePath);
          try {
            await deleteFiles(filePaths);
            await pruneTracks(tracksToDelete);
            const total = await dbGetTrackCount();
            setTrackCount(total);
            await invalidateLibraryForMutation(queryClient, 'delete');
          } catch (err) {
            reportError('Failed to delete files', { source: 'app', error: err });
          }
        },
      });
    },
    [pruneTracks, queryClient, setConfirmDialog, setTrackCount],
  );

  const handleRenameTrack = useCallback(
    async (track: Track, newName: string) => {
      if (!newName || !track) return;
      try {
        const newPath = await renameFile(track.filePath, newName);
        applyTrackPathUpdates({ [track.filePath]: newPath });
        await invalidateLibraryForMutation(queryClient, 'rename');
      } catch (err) {
        reportError('Failed to rename file', { source: 'app', error: err });
      }
    },
    [applyTrackPathUpdates, queryClient],
  );

  const handleMoveTracks = useCallback(
    async (tracksToMove: Track[], destination: string) => {
      if (!tracksToMove || tracksToMove.length === 0 || !destination) return;
      const replacements: Record<string, string> = {};
      for (const track of tracksToMove) {
        try {
          const targetPath = await moveFile(track.filePath, destination);
          replacements[track.filePath] = targetPath;
        } catch (err) {
          reportError('Failed to move file', { source: 'app', error: err });
        }
      }
      applyTrackPathUpdates(replacements);
      if (Object.keys(replacements).length > 0) {
        await invalidateLibraryForMutation(queryClient, 'rename');
      }
    },
    [applyTrackPathUpdates, queryClient],
  );

  return {
    handleRemoveTracks,
    handleDeleteFiles,
    handleRenameTrack,
    handleMoveTracks,
    handleCopyMetadata,
    handlePasteMetadata,
    applyTrackRatings,
    applyTrackPathUpdates,
    pruneTracks,
  };
}
