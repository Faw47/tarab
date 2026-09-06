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
          role="alert"
          className={cn(
            'flex items-start justify-between gap-4 p-4 text-sm',
            isNeo
              ? 'rounded-none border-[3px] border-black bg-[var(--state-error-surface)] shadow-[var(--neo-shadow-lg)]'
              : 'rounded-2xl border border-[var(--state-error-border)] bg-[var(--state-error-surface)] text-[var(--state-error-ink)] backdrop-blur-sm',
          )}
        >
          <div>
            <p
              className={cn(
                isNeo
                  ? 'font-black uppercase tracking-[0.08em] text-black'
                  : 'font-semibold text-[var(--state-error-ink)]',
              )}
            >
              {appError.message}
            </p>
            {appError.detail ? (
              <p
                className={cn(
                  'mt-1',
                  isNeo ? 'font-bold text-black' : 'text-[var(--state-error-ink)]',
                )}
              >
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
                ? 'rounded-none border-2 border-black bg-white text-black shadow-[var(--neo-shadow-xs)] hover:bg-[var(--neo-muted)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
                : 'text-[var(--state-error-ink)] hover:text-[var(--type-primary)]',
            )}
            onClick={onDismissError}
            aria-label="Dismiss error"
          >
            <X
              className={cn('h-4 w-4', isNeo ? 'text-black' : 'text-[var(--state-error-ink)]')}
              strokeWidth={isNeo ? 3 : undefined}
            />
          </IconButton>
        </div>
      ) : null}

      {playlistRepair ? (
        <div
          role="alert"
          className={cn(
            'flex flex-col gap-3 p-4 text-sm lg:flex-row lg:items-center lg:justify-between',
            isNeo
              ? 'rounded-none border-[3px] border-black bg-[var(--state-warning-surface)] shadow-[var(--neo-shadow-lg)]'
              : 'rounded-2xl border border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] text-[var(--state-warning-ink)] backdrop-blur-sm',
          )}
        >
          <div>
            <p
              className={cn(
                isNeo
                  ? 'font-black uppercase tracking-[0.08em] text-black'
                  : 'font-semibold text-[var(--state-warning-ink)]',
              )}
            >
              {playlistWasRecovered ? 'Playlist data recovered' : 'Playlist data needs repair'}
            </p>
            <p
              className={cn(
                'mt-1',
                isNeo ? 'font-bold text-black' : 'text-[var(--state-warning-ink)]',
              )}
            >
              {playlistRepair.reason}
            </p>
            <p
              className={cn(
                'mt-1 text-xs',
                isNeo ? 'font-bold text-black' : 'text-[var(--state-warning-ink)]',
              )}
            >
              {playlistRepair.attemptedRecovery
                ? playlistRepair.recoveredFrom
                  ? `Recovered from ${playlistRepair.recoveredFrom}.`
                  : 'Automatic recovery was attempted but no valid backup was found.'
                : 'Automatic recovery has not run yet.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className={cn(
                isNeo
                  ? 'rounded-none border-2 border-black bg-[var(--neo-lavender)] font-black uppercase text-black shadow-[var(--neo-shadow-md)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
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
                  ? 'rounded-none border-2 border-black bg-white font-black uppercase text-black shadow-[var(--neo-shadow-md)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
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
                  ? 'rounded-none border-2 border-black bg-[var(--neo-sage)] font-black uppercase text-black shadow-[var(--neo-shadow-md)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
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
