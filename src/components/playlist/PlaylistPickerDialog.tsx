import { clsx } from 'clsx';
import { Plus, Search, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  useAddTracksMutation,
  useCreatePlaylistMutation,
} from '../../features/playlists/mutations';
import { usePlaylistsQuery } from '../../features/playlists/queries';
import { reportError } from '../../lib/report-error';
import { useSettingsStore } from '../../store/settings-store';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { IconButton } from '../ui/IconButton';
import { PlaylistIcon } from '../ui/Icons';
import { Input } from '../ui/Input';
import { PlaylistEditorDialog } from './PlaylistEditorDialog';

interface PlaylistPickerDialogProps {
  open: boolean;
  trackIds: string[];
  onClose: () => void;
  onAdded?: (playlistId: string) => void;
}

export const PlaylistPickerDialog = memo(
  ({ open, trackIds, onClose, onAdded }: PlaylistPickerDialogProps) => {
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';
    const { data: playlists = [], isLoading, isError, refetch } = usePlaylistsQuery(open);
    const addTracksMutation = useAddTracksMutation();
    const createPlaylistMutation = useCreatePlaylistMutation();

    const isSaving = addTracksMutation.isPending || createPlaylistMutation.isPending;

    const [query, setQuery] = useState('');
    const [showCreateDialog, setShowCreateDialog] = useState(false);

    useEffect(() => {
      if (!open) {
        setQuery('');
        setShowCreateDialog(false);
      }
    }, [open]);

    const filteredPlaylists = useMemo(() => {
      const needle = query.trim().toLowerCase();
      const manualPlaylists = playlists.filter((playlist) => playlist.playlistType === 'Manual');
      if (!needle) return manualPlaylists;
      return manualPlaylists.filter((playlist) => playlist.name.toLowerCase().includes(needle));
    }, [playlists, query]);

    const handleAdd = async (playlistId: string) => {
      try {
        await addTracksMutation.mutateAsync({ playlistId, trackIds });
        onAdded?.(playlistId);
        onClose();
      } catch (error) {
        reportError('Failed to add tracks to playlist', {
          source: 'playlist-picker-dialog',
          error,
        });
      }
    };

    return (
      <>
        <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
          <DialogContent
            showCloseButton={false}
            className={clsx(
              'w-full max-w-lg p-6',
              isNeobrutalism
                ? 'bg-white border-3 border-black shadow-[var(--neo-shadow-2xl)] radius-r3'
                : 'rounded-2xl border border-zinc-800 bg-surface shadow-2xl',
            )}
          >
            <DialogHeader className="mb-4 flex-row items-center justify-between gap-3 space-y-0 text-left">
              <div>
                <DialogTitle
                  className={clsx(
                    'text-lg',
                    isNeobrutalism
                      ? 'font-black uppercase tracking-normal text-black'
                      : 'font-semibold text-text-primary',
                  )}
                >
                  Add to playlist
                </DialogTitle>
                <DialogDescription
                  className={clsx(
                    'text-xs mt-1',
                    isNeobrutalism ? 'font-bold text-black/60' : 'text-text-muted',
                  )}
                >
                  {trackIds.length} track{trackIds.length === 1 ? '' : 's'} selected
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={isNeobrutalism ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setShowCreateDialog(true)}
                  className="gap-1"
                >
                  <Plus className="w-4 h-4" />
                  New
                </Button>
                <IconButton
                  size="sm"
                  variant={isNeobrutalism ? 'default' : 'ghost'}
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </IconButton>
              </div>
            </DialogHeader>

            <div className="relative mb-3">
              <Search
                className={clsx(
                  'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4',
                  isNeobrutalism ? 'text-black' : 'text-text-muted',
                )}
              />
              <Input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search playlists"
                aria-label="Search playlists"
                theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                className="w-full pl-9 pr-3 py-2"
              />
            </div>

            <div
              className={clsx(
                'max-h-[360px] overflow-y-auto custom-scrollbar',
                isNeobrutalism
                  ? 'border-2 border-black bg-white radius-r2 p-1 shadow-[inner_0_4px_0_rgba(0,0,0,0.05)]'
                  : 'rounded-xl border border-white/5 bg-black/10',
              )}
            >
              {isLoading ? (
                <div
                  className="p-6 text-sm text-center text-text-muted"
                  role="status"
                  aria-label="Loading playlists"
                >
                  Loading playlists...
                </div>
              ) : isError ? (
                <div className="p-6 text-center text-sm text-red-400" role="alert">
                  Tarab could not load playlists.
                  <Button className="mt-3" size="sm" onClick={() => void refetch()}>
                    Retry
                  </Button>
                </div>
              ) : filteredPlaylists.length === 0 ? (
                <div className="p-8 text-center text-sm text-text-muted">
                  <PlaylistIcon className="w-8 h-8 mx-auto mb-2 opacity-60" />
                  No playlists found
                </div>
              ) : (
                <div className="p-1 space-y-1">
                  {filteredPlaylists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      onClick={() => handleAdd(playlist.id)}
                      disabled={isSaving}
                      className={clsx(
                        'w-full text-left px-3 py-3 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] disabled:opacity-50',
                        isNeobrutalism
                          ? 'bg-white border-2 border-transparent hover:border-black hover:bg-[var(--signal-active)] radius-r1 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--neo-shadow-xs)]'
                          : 'rounded-lg hover:bg-white/10',
                      )}
                    >
                      <p
                        className={clsx(
                          'text-sm truncate',
                          isNeobrutalism
                            ? 'font-black uppercase text-black'
                            : 'font-medium text-text-primary',
                        )}
                      >
                        {playlist.name}
                      </p>
                      <p
                        className={clsx(
                          'text-xs mt-0.5',
                          isNeobrutalism ? 'font-bold text-black/50' : 'text-text-muted',
                        )}
                      >
                        {playlist.trackCount} tracks
                        {playlist.missingCount > 0 ? ` - ${playlist.missingCount} unavailable` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <PlaylistEditorDialog
          open={showCreateDialog}
          mode="create"
          isSaving={createPlaylistMutation.isPending}
          onClose={() => setShowCreateDialog(false)}
          onSave={async ({ name, playlistType, smartRules, folderPath }) => {
            const created = await createPlaylistMutation.mutateAsync({
              name,
              playlistType,
              smartRules,
              folderPath,
            });
            if (created.playlistType === 'Manual') {
              await addTracksMutation.mutateAsync({ playlistId: created.id, trackIds });
              onAdded?.(created.id);
              onClose();
            }
            setShowCreateDialog(false);
            return true;
          }}
        />
      </>
    );
  },
);

PlaylistPickerDialog.displayName = 'PlaylistPickerDialog';
