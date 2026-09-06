import { useCallback, useRef } from 'react';
import {
  playAdjacentTrack,
  startPlayback,
  toggleCurrentPlayback,
} from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { getSmartShuffleQueue, revealInFileManager } from '../../lib/tauri-commands';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import { appendShuffleQueue } from '../library/appendShuffleQueue';
import { loadLargeShufflePlan } from '../library/loadLargeShufflePlan';
import {
  loadTracksForShuffle,
  SHUFFLE_PAGE_SIZE,
  shuffleTracks,
} from '../library/loadTracksForShuffle';

interface UseAppCommandActionsOptions {
  libraryTracks: Track[];
  totalTracks: number;
  isScanning: boolean;
  rescanAll: () => Promise<unknown>;
  addToQueue: (track: Track) => void;
  addTracksToQueue: (tracks: Track[]) => void;
  openTagEditor: (tracks: Track[]) => void;
  startProcessing: (label: string) => string;
  updateProcessing: (id: string, progress?: number, status?: 'running' | 'done') => void;
  finishProcessing: (id: string) => void;
}

export function useAppCommandActions({
  libraryTracks,
  totalTracks,
  isScanning,
  rescanAll,
  addToQueue,
  addTracksToQueue,
  openTagEditor,
  startProcessing,
  updateProcessing,
  finishProcessing,
}: UseAppCommandActionsOptions) {
  const shuffleInFlightRef = useRef(false);

  const handleShuffleAll = useCallback(async () => {
    if (libraryTracks.length === 0 || shuffleInFlightRef.current) return;

    shuffleInFlightRef.current = true;
    let processingId: string | null = null;
    try {
      if (totalTracks > libraryTracks.length || totalTracks > SHUFFLE_PAGE_SIZE) {
        processingId = startProcessing('Preparing library shuffle');
      }

      const activeProcessingId = processingId;
      const updateShuffleProgress = activeProcessingId
        ? (progress: number) => updateProcessing(activeProcessingId, progress, 'running')
        : undefined;
      const shouldHydrateFromIds =
        totalTracks > libraryTracks.length || totalTracks > SHUFFLE_PAGE_SIZE;
      if (shouldHydrateFromIds) {
        try {
          updateShuffleProgress?.(5);
          const plan = await loadLargeShufflePlan(useSettingsStore.getState().smartShuffleEnabled);
          if (!plan) throw new Error('No tracks were available for shuffle.');
          updateShuffleProgress?.(25);
          await startPlayback(plan.firstTrack, {
            queue: [plan.firstTrack],
            queueIndex: 0,
            shuffleEnabled: true,
          });
          const result = await appendShuffleQueue({
            orderedIds: plan.orderedIds,
            firstTrack: plan.firstTrack,
            addToQueue,
            addTracksToQueue,
            onProgress: updateShuffleProgress,
          });
          if (result.cancelled) return;
        } catch (error) {
          reportError('Failed to prepare large-library shuffle', {
            source: 'app-command-actions',
            error,
          });
        }
        return;
      }

      let allTracks: Track[];
      try {
        allTracks = await loadTracksForShuffle({
          loadedTracks: libraryTracks,
          totalTracks,
          onProgress: activeProcessingId
            ? (progress) => updateProcessing(activeProcessingId, progress, 'running')
            : undefined,
        });
      } catch (error) {
        reportError('Failed to load tracks for shuffle', {
          source: 'app-command-actions',
          error,
        });
        return;
      }

      let shuffled: Track[];
      const smartShuffle = useSettingsStore.getState().smartShuffleEnabled;
      if (smartShuffle) {
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
    } finally {
      if (processingId) finishProcessing(processingId);
      shuffleInFlightRef.current = false;
    }
  }, [
    addToQueue,
    addTracksToQueue,
    finishProcessing,
    libraryTracks,
    startProcessing,
    totalTracks,
    updateProcessing,
  ]);
  const handleTogglePlayback = useCallback(async () => {
    try {
      await toggleCurrentPlayback();
    } catch (error) {
      reportError('Playback toggle failed', { source: 'app-command-actions', error });
    }
  }, []);

  const handleNextTrack = useCallback(async () => {
    try {
      await playAdjacentTrack('next');
    } catch (error) {
      reportError('Failed to play next track', { source: 'app-command-actions', error });
    }
  }, []);

  const handlePreviousTrack = useCallback(async () => {
    try {
      await playAdjacentTrack('previous');
    } catch (error) {
      reportError('Failed to play previous track', { source: 'app-command-actions', error });
    }
  }, []);

  const handleRescan = useCallback(async () => {
    if (isScanning) return;
    try {
      await rescanAll();
    } catch (error) {
      reportError('Failed to rescan library', { source: 'app-command-actions', error });
    }
  }, [isScanning, rescanAll]);

  const handleAddTracksToQueue = useCallback(
    (tracks: Track[]) => {
      addTracksToQueue(tracks);
    },
    [addTracksToQueue],
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
