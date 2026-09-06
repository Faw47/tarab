import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PlaylistEditorForm } from '../../features/playlists/components/PlaylistEditorForm';
import { useSettingsStore } from '../../store/settings-store';
import type { BackendSmartPlaylistRule, PlaylistType } from '../../types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { IconButton } from '../ui/IconButton';

interface PlaylistEditorDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  isSaving?: boolean;
  initial?: {
    name?: string;
    playlistType?: PlaylistType;
    smartRules?: BackendSmartPlaylistRule[];
    folderPath?: string;
  };
  onClose: () => void;
  onSave: (payload: {
    name: string;
    playlistType: PlaylistType;
    smartRules?: BackendSmartPlaylistRule[];
    folderPath?: string;
  }) => Promise<boolean | undefined> | boolean | undefined;
}

export const PlaylistEditorDialog = memo(
  ({ open, mode, isSaving = false, initial, onClose, onSave }: PlaylistEditorDialogProps) => {
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';
    const title = mode === 'create' ? 'Create playlist' : 'Edit playlist';

    return (
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
        <DialogContent
          showCloseButton={false}
          className={clsx(
            'w-full max-w-xl p-6',
            isNeobrutalism
              ? 'bg-white border-3 border-black shadow-[var(--neo-shadow-2xl)] radius-r3'
              : 'rounded-2xl border border-zinc-800 bg-surface shadow-2xl',
          )}
        >
          <DialogHeader className="mb-5 flex-row items-center justify-between space-y-0 text-left">
            <DialogTitle
              className={clsx(
                'text-lg',
                isNeobrutalism
                  ? 'font-black uppercase tracking-normal text-black'
                  : 'font-semibold text-text-primary',
              )}
            >
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {mode === 'create'
                ? 'Create a playlist and choose how its tracks are managed.'
                : 'Update this playlist and how its tracks are managed.'}
            </DialogDescription>
            <IconButton
              size="sm"
              variant={isNeobrutalism ? 'default' : 'ghost'}
              onClick={onClose}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </IconButton>
          </DialogHeader>

          <PlaylistEditorForm
            mode={mode}
            isSaving={isSaving}
            initial={initial}
            onCancel={onClose}
            onSave={async (payload) => {
              const result = await onSave(payload);
              if (result !== false) onClose();
              return result;
            }}
          />
        </DialogContent>
      </Dialog>
    );
  },
);

PlaylistEditorDialog.displayName = 'PlaylistEditorDialog';
