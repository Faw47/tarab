import { useCallback } from 'react';
import {
  getPlaybackInterventionEpoch,
  notePlaybackIntervention,
} from './playback-generation';
import {
  playAdjacentTrack,
  startPlayback,
  toggleCurrentPlayback,
} from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { dbGetShuffleAllQueue, revealInFileManager } from '../../lib/tauri-commands';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import { fetchLibraryTrackById } from '../library/api';
import { createLazyQueueTrack } from '../library/loadTracksForShuffle';

interface UseAppCommandActionsOptions {
  totalTracks: number;
  isScanning: boolean;
  rescanAll: () => Promise<unknown>;
  addToQueue: (track: Track) => void;
  openTagEditor: (tracks: Track[]) => void;
}

export function useAppCommandActions({
  totalTracks,
  isScanning,
  rescanAll,
  addToQueue,
  openTagEditor,
}: UseAppCommandActionsOptions) {
  const handleShuffleAll = useCallback(async () => {
    if (totalTracks <= 0) return;

    notePlaybackIntervention();
    const intervention = getPlaybackInterventionEpoch();
    try {
      const references = await dbGetShuffleAllQueue(
        useSettingsStore.getState().smartShuffleEnabled,
      );
      if (getPlaybackInterventionEpoch() !== intervention) return;
      const firstReference = references[0];
      if (!firstReference) return;

      const firstTrack = await fetchLibraryTrackById(firstReference.id);
      if (getPlaybackInterventionEpoch() !== intervention) return;
      if (!firstTrack) {
        throw new Error('The first shuffled library track could not be loaded');
      }

      const queue = references.map((reference, index) =>
        index === 0 ? firstTrack : createLazyQueueTrack(reference),
      );
      await startPlayback(firstTrack, {
        queue,
        queueIndex: 0,
        shuffleEnabled: true,
      });
    } catch (error) {
      if (getPlaybackInterventionEpoch() !== intervention) return;
      reportError('Failed to shuffle all tracks', { source: 'app-command-actions', error });
    }
  }, [totalTracks]);

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
