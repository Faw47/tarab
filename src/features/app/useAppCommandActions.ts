import { useCallback } from 'react';
import {
  playAdjacentTrack,
  startPlayback,
  toggleCurrentPlayback,
} from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { getSmartShuffleQueue, revealInFileManager } from '../../lib/tauri-commands';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import { loadTracksForShuffle, shuffleTracks } from '../library/loadTracksForShuffle';

interface UseAppCommandActionsOptions {
  libraryTracks: Track[];
  totalTracks: number;
  isScanning: boolean;
  rescanAll: () => Promise<unknown>;
  addToQueue: (track: Track) => void;
  openTagEditor: (tracks: Track[]) => void;
}

export function useAppCommandActions({
  libraryTracks,
  totalTracks,
  isScanning,
  rescanAll,
  addToQueue,
  openTagEditor,
}: UseAppCommandActionsOptions) {
  const handleShuffleAll = useCallback(async () => {
    if (libraryTracks.length === 0) return;

    let allTracks = libraryTracks;
    try {
      allTracks = await loadTracksForShuffle({ loadedTracks: libraryTracks, totalTracks });
    } catch (error) {
      reportError('Failed to load tracks for shuffle', {
        source: 'app-command-actions',
        error,
      });
    }

    let shuffled: Track[];
    if (useSettingsStore.getState().smartShuffleEnabled) {
      try {
        const order = await getSmartShuffleQueue(allTracks.map((track) => track.id));
        const byId = new Map(allTracks.map((track) => [track.id, track] as const));
        shuffled = order
          .map((id) => byId.get(id))
          .filter((track): track is Track => Boolean(track));
        if (shuffled.length !== allTracks.length) shuffled = shuffleTracks(allTracks);
      } catch {
        shuffled = shuffleTracks(allTracks);
      }
    } else {
      shuffled = shuffleTracks(allTracks);
    }

    const first = shuffled[0];
    if (!first) return;
    try {
      await startPlayback(first, {
        queue: shuffled,
        queueIndex: 0,
        shuffleEnabled: true,
      });
    } catch (error) {
      reportError('Failed to shuffle all tracks', { source: 'app-command-actions', error });
    }
  }, [libraryTracks, totalTracks]);

  const handleTogglePlayback = useCallback(async () => {
    await toggleCurrentPlayback();
  }, []);

  const handleNextTrack = useCallback(async () => {
    await playAdjacentTrack('next');
  }, []);

  const handlePreviousTrack = useCallback(async () => {
    await playAdjacentTrack('previous');
  }, []);

  const handleRescan = useCallback(async () => {
    if (isScanning) return;
    await rescanAll();
  }, [isScanning, rescanAll]);

  const handleAddTracksToQueue = useCallback(
    (tracks: Track[]) => {
      tracks.forEach((track) => addToQueue(track));
    },
    [addToQueue],
  );

  const handleRevealTrack = useCallback(async (track: Track) => {
    try {
      await revealInFileManager(track.filePath);
    } catch (error) {
      reportError('Failed to reveal track in folder', {
        source: 'app-command-actions',
        error,
      });
    }
  }, []);

  const handleRevealTracks = useCallback(async (tracks: Track[]) => {
    const first = tracks[0];
    if (!first) return;
    try {
      await revealInFileManager(first.filePath);
    } catch (error) {
      reportError('Failed to reveal track in folder', {
        source: 'app-command-actions',
        error,
      });
    }
  }, []);

  return {
    handleShuffleAll,
    handleTogglePlayback,
    handleNextTrack,
    handlePreviousTrack,
    handleRescan,
    handleOpenTagEditor: openTagEditor,
    handleAddTracksToQueue,
    handleRevealTrack,
    handleRevealTracks,
  };
}
