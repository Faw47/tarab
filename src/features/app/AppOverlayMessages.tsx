import { X } from 'lucide-react';
import { memo } from 'react';
import { Button } from '../../components/ui/button';
import { IconButton } from '../../components/ui/IconButton';
import { cn } from '../../lib/utils';
import type { AppTheme } from '../../store/settings-store';
import type { PlaylistRepairState } from './app-state-types';

export interface AppOverlayMessagesProps {
  appError: { message: string; detail?: string } | null;
  playlistRepair: PlaylistRepairState | null;
  theme: AppTheme;
  onDismissError: () => void;
  onRetryPlaylistLoad: () => void;
  onResetPlaylistData: () => void;
  onOpenPlaylistsDataFolder: () => void;
}

export const AppOverlayMessages = memo(function AppOverlayMessages({
  appError,
  playlistRepair,
  theme,
  onDismissError,
  onRetryPlaylistLoad,
  onResetPlaylistData,
  onOpenPlaylistsDataFolder,
}: AppOverlayMessagesProps) {
  if (!appError && !playlistRepair) return null;

  const isNeo = theme === 'neobrutalism';
  const playlistWasRecovered = Boolean(
    playlistRepair?.attemptedRecovery && playlistRepair.recoveredFrom,
  );

  return (
    <div className="absolute left-8 right-8 top-4 z-40 flex flex-col gap-3">
      {appError ? (
        <div
          className={cn(
            'flex items-start justify-between gap-4 p-4 text-sm',
            isNeo
              ? 'rounded-none border-[3px] border-black bg-[#D88274] shadow-[6px_6px_0_0_#000]'
              : 'rounded-2xl border border-red-400/40 bg-red-950/55 backdrop-blur-sm',
          )}
        >
          <div>
            <p
              className={cn(
                isNeo
                  ? 'font-black uppercase tracking-[0.08em] text-black'
                  : 'font-semibold text-red-100',
              )}
            >
              {appError.message}
            </p>
            {appError.detail ? (
              <p className={cn('mt-1', isNeo ? 'font-bold text-black' : 'text-red-200/85')}>
                {appError.detail}
              </p>
            ) : null}
          </div>
          <IconButton
            size="sm"
            variant={isNeo ? 'default' : 'ghost'}
            className={cn(
              'shrink-0',
              isNeo
                ? 'rounded-none border-2 border-black bg-white text-black shadow-[2px_2px_0_0_#000] hover:bg-[var(--neo-muted)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
                : 'text-red-100 hover:text-white',
            )}
            onClick={onDismissError}
            aria-label="Dismiss error"
          >
            <X
              className={cn('h-4 w-4', isNeo ? 'text-black' : 'text-red-100')}
              strokeWidth={isNeo ? 3 : undefined}
            />
          </IconButton>
        </div>
      ) : null}

      {playlistRepair ? (
        <div
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
