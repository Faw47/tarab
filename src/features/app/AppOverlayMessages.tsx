import { memo, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { AppTheme } from '../../store/settings-store';
import type { PlaylistRepairState } from './app-state-types';

export interface AppOverlayMessagesProps {
  playlistRepair: PlaylistRepairState | null;
  /** Playback recovery actions, rendered first while a playback failure is unresolved. */
  playbackRecovery?: ReactNode;
  /** True when a transparent header overlays the content (liquid album view). */
  belowHeader?: boolean;
  theme: AppTheme;
  onRetryPlaylistLoad: () => void;
  onResetPlaylistData: () => void;
  onOpenPlaylistsDataFolder: () => void;
}

export const AppOverlayMessages = memo(function AppOverlayMessages({
  playlistRepair,
  playbackRecovery,
  belowHeader = false,
  theme,
  onRetryPlaylistLoad,
  onResetPlaylistData,
  onOpenPlaylistsDataFolder,
}: AppOverlayMessagesProps) {
  if (!playlistRepair && !playbackRecovery) return null;

  const isNeo = theme === 'neobrutalism';
  const playlistWasRecovered = Boolean(
    playlistRepair?.attemptedRecovery && playlistRepair.recoveredFrom,
  );

  return (
    <div
      className={cn(
        'absolute left-8 right-8 z-40 flex flex-col gap-3',
        belowHeader ? 'top-[4.5rem]' : 'top-4',
      )}
    >
      {playbackRecovery}
      {playlistRepair ? (
        <div
          role="status"
          className={cn(
            'flex flex-col gap-3 p-4 text-sm lg:flex-row lg:items-center lg:justify-between',
            isNeo
              ? 'rounded-none border-[3px] border-black bg-[#DAB852] shadow-[6px_6px_0_0_#000]'
              : 'rounded-2xl border border-amber-300/35 bg-amber-950/45 backdrop-blur-sm',
          )}
        >
          <div>
            <p
              className={cn(
                isNeo
                  ? 'font-black uppercase tracking-[0.08em] text-black'
                  : 'font-semibold text-amber-100',
              )}
            >
              {playlistWasRecovered ? 'Playlist data recovered' : 'Playlist data needs repair'}
            </p>
            <p className={cn('mt-1', isNeo ? 'font-bold text-black' : 'text-amber-200/85')}>
              {playlistRepair.reason}
            </p>
            <p className={cn('mt-1 text-xs', isNeo ? 'font-bold text-black' : 'text-amber-200/70')}>
              {playlistRepair.attemptedRecovery
                ? playlistRepair.recoveredFrom
                  ? `Recovered from ${playlistRepair.recoveredFrom}.`
                  : 'Automatic recovery was attempted but no valid backup was found.'
                : 'Automatic recovery has not run yet.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className={cn(
                isNeo
                  ? 'rounded-none border-2 border-black bg-[#A091D0] font-black uppercase text-black shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
                  : 'rounded-xl',
              )}
              onClick={onRetryPlaylistLoad}
            >
              Retry load
            </Button>
            <Button
              variant="secondary"
              className={cn(
                isNeo
                  ? 'rounded-none border-2 border-black bg-white font-black uppercase text-black shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
                  : 'rounded-xl',
              )}
              onClick={onResetPlaylistData}
            >
              Reset playlists file
            </Button>
            <Button
              variant="secondary"
              className={cn(
                isNeo
                  ? 'rounded-none border-2 border-black bg-[#A4B680] font-black uppercase text-black shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
                  : 'rounded-xl',
              )}
              onClick={onOpenPlaylistsDataFolder}
            >
              Open data folder
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
