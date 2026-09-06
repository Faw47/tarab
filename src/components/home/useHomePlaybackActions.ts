import { useCallback } from 'react';
import { playAdjacentTrack, toggleCurrentPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import type { Track } from '../../types';

export function useHomePlaybackActions(currentTrack: Track | null, source: string) {
  const handleTogglePlay = useCallback(async () => {
    if (!currentTrack) return;
    try {
      await toggleCurrentPlayback();
    } catch (error) {
      reportError('toggle failed', { source, error });
    }
  }, [currentTrack, source]);

  const handlePrevious = useCallback(async () => {
    try {
      await playAdjacentTrack('previous');
    } catch (error) {
      reportError('previous failed', { source, error });
    }
  }, [source]);

  const handleNext = useCallback(async () => {
    try {
      await playAdjacentTrack('next');
    } catch (error) {
      reportError('next failed', { source, error });
    }
  }, [source]);

  return { handleTogglePlay, handlePrevious, handleNext };
}
