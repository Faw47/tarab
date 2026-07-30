import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { NavView } from '../../components/navigation';
import { useSessionPersistence } from '../../hooks/useSessionPersistence';
import { usePlayerStore } from '../../store/player-store';
import type { AlbumDetailsState } from './app-state-types';

interface UseAppSessionPersistenceOptions {
  currentView: NavView;
  albumDetails: AlbumDetailsState | null;
}

export function useAppSessionPersistence({
  currentView,
  albumDetails,
}: UseAppSessionPersistenceOptions) {
  const {
    currentTrackId,
    isPlaying,
    shuffleEnabled,
    loopMode,
    stopAfterCurrent,
    queueVersion,
    queueIndex,
    playbackSpeed,
  } = usePlayerStore(
    useShallow((state) => ({
      currentTrackId: state.currentTrack?.id,
      isPlaying: state.isPlaying,
      shuffleEnabled: state.shuffleEnabled,
      loopMode: state.loopMode,
      stopAfterCurrent: state.stopAfterCurrent,
      queueVersion: state.queueVersion,
      queueIndex: state.queueIndex,
      playbackSpeed: state.playbackSpeed,
    })),
  );

  const { scheduleSessionSave, flushSessionSave, lastSavedPositionRef, lastSessionSaveRef } =
    useSessionPersistence(currentView, albumDetails);

  useEffect(() => {
    scheduleSessionSave(true);
  }, [
    currentTrackId,
    queueVersion,
    queueIndex,
    playbackSpeed,
    shuffleEnabled,
    loopMode,
    stopAfterCurrent,
    currentView,
    isPlaying,
    scheduleSessionSave,
  ]);

  useEffect(() => {
    const unsubscribe = usePlayerStore.subscribe((state, previousState) => {
      if (state.volume !== previousState.volume) {
        scheduleSessionSave(true);
      }
    });
    return unsubscribe;
  }, [scheduleSessionSave]);

  return { scheduleSessionSave, flushSessionSave, lastSavedPositionRef, lastSessionSaveRef };
}
