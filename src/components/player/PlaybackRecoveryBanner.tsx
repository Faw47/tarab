import { AlertTriangle } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { playAdjacentTrack, startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { revealInFileManager } from '../../lib/tauri-commands';
import { cn } from '../../lib/utils';
import { type PlaybackFailure, usePlayerStore } from '../../store/player-store';
import type { AppTheme } from '../../store/settings-store';

/** A short, plain title for a native playback failure; the backend message is the detail. */
export function playbackFailureTitle(stage: PlaybackFailure['stage'] | undefined): string {
  switch (stage) {
    case 'decode':
      return 'This track could not be decoded';
    case 'seek':
      return 'Could not seek in this track';
    case 'deviceSwitch':
      return 'Could not switch the audio output';
    case 'stream':
      return 'The audio output stopped';
    case 'preflight':
      return 'This track could not be opened';
    default:
      return 'Playback could not continue';
  }
}

export interface PlaybackRecoveryBannerProps {
  theme: AppTheme;
  /** `overlay` floats over the full player; `shell` sits in the main window's message stack. */
  placement: 'overlay' | 'shell';
}

/**
 * Recovery actions for the current playback failure. The full player and the main shell both
 * render it, so Retry, Skip, Reveal and Remove are reachable wherever playback stopped.
 */
export const PlaybackRecoveryBanner = memo(function PlaybackRecoveryBanner({
  theme,
  placement,
}: PlaybackRecoveryBannerProps) {
  const { currentTrack, playbackError, setPlaybackError, removeFromQueue } = usePlayerStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      playbackError: s.playbackError,
      setPlaybackError: s.setPlaybackError,
      removeFromQueue: s.removeFromQueue,
    })),
  );

  const handleRetry = useCallback(async () => {
    const track = usePlayerStore.getState().currentTrack;
    if (!track) return;
    try {
      await startPlayback(track, { startPos: usePlayerStore.getState().currentTime });
      setPlaybackError(null);
    } catch (error) {
      reportError('Playback retry failed', { source: 'playback-recovery', error });
    }
  }, [setPlaybackError]);

  const handleSkip = useCallback(async () => {
    try {
      await playAdjacentTrack('next');
      setPlaybackError(null);
    } catch (error) {
      reportError('Could not skip to the next track', { source: 'playback-recovery', error });
    }
  }, [setPlaybackError]);

  const handleReveal = useCallback(async () => {
    const path = usePlayerStore.getState().playbackError?.filePath;
    if (!path) return;
    try {
      await revealInFileManager(path);
    } catch (error) {
      reportError('Could not reveal the file', { source: 'playback-recovery', error });
    }
  }, []);

  const handleRemove = useCallback(async () => {
    const failedTrack = usePlayerStore.getState().currentTrack;
    try {
      await playAdjacentTrack('next');
    } catch {
      // The failed item can still be removed when there is no playable next item.
    }
    if (failedTrack) {
      const index = usePlayerStore
        .getState()
        .queue.findIndex(
          (track) =>
            (failedTrack._queueId && track._queueId === failedTrack._queueId) ||
            track.id === failedTrack.id,
        );
      if (index >= 0) removeFromQueue(index);
    }
    setPlaybackError(null);
  }, [removeFromQueue, setPlaybackError]);

  if (!playbackError || !currentTrack) return null;

  const isNeo = theme === 'neobrutalism';
  const actionClass = isNeo
    ? 'rounded-none border-2 border-black bg-white px-3 py-2 font-black uppercase text-black shadow-[2px_2px_0_0_#000] hover:bg-[var(--neo-muted)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
    : 'rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20';

  return (
    <div
      role="alert"
      data-testid="playback-recovery"
      className={cn(
        'flex flex-wrap items-center gap-3 p-4 text-sm',
        placement === 'overlay' && 'absolute inset-x-6 top-20 z-[70] mx-auto max-w-3xl',
        isNeo
          ? 'rounded-none border-[3px] border-black bg-[#D88274] text-black shadow-[6px_6px_0_0_#000]'
          : 'rounded-xl border border-red-300/35 bg-red-950/90 text-red-50 shadow-2xl backdrop-blur-xl',
      )}
    >
      <AlertTriangle
        className={cn('h-5 w-5 shrink-0', isNeo ? 'text-black' : 'text-red-300')}
        aria-hidden="true"
      />
      <div className="min-w-48 flex-1">
        <p className={isNeo ? 'font-black uppercase tracking-[0.08em]' : 'font-semibold'}>
          {playbackFailureTitle(playbackError.stage)}
        </p>
        <p className={isNeo ? 'font-bold' : 'text-red-100/80'}>
          <bdi>{currentTrack.title}</bdi>: {playbackError.message}
        </p>
      </div>
      <button type="button" className={actionClass} onClick={handleRetry}>
        Retry
      </button>
      <button type="button" className={actionClass} onClick={handleSkip}>
        Skip
      </button>
      {playbackError.filePath ? (
        <button type="button" className={actionClass} onClick={handleReveal}>
          Reveal in Finder
        </button>
      ) : null}
      <button type="button" className={actionClass} onClick={handleRemove}>
        Remove from Queue
      </button>
      <button
        type="button"
        className={actionClass}
        onClick={() => setPlaybackError(null)}
        aria-label="Dismiss playback error"
      >
        Dismiss
      </button>
    </div>
  );
});
