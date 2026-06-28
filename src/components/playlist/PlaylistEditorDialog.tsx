import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PlaylistEditorForm } from '../../features/playlists/components/PlaylistEditorForm';
import { useSettingsStore } from '../../store/settings-store';
import type { BackendSmartPlaylistRule, PlaylistType } from '../../types';
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
  }) => Promise<void> | void;
}

export const PlaylistEditorDialog = memo(
  ({ open, mode, isSaving = false, initial, onClose, onSave }: PlaylistEditorDialogProps) => {
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';

    if (!open) return null;

    const title = mode === 'create' ? 'Create playlist' : 'Edit playlist';

    return (
      <div
        className={clsx(
          'fixed inset-0 z-[120] flex items-center justify-center p-4 transition-all duration-200',
          isNeobrutalism ? 'bg-black/50' : 'bg-black/70 backdrop-blur-sm',
        )}
        onClick={onClose}
      >
        <section
          className={clsx(
            'w-full max-w-xl p-6',
            isNeobrutalism
              ? 'bg-white border-3 border-black shadow-[12px_12px_0_0_#000] radius-r3'
              : 'rounded-2xl border border-zinc-800 bg-surface shadow-2xl',
          )}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <header className="flex items-center justify-between mb-5">
            <h3
              className={clsx(
                'text-lg',
                isNeobrutalism
                  ? 'font-black uppercase tracking-tight text-black'
                  : 'font-semibold text-text-primary',
              )}
            >
              {title}
            </h3>
            <IconButton
              size="sm"
              variant={isNeobrutalism ? 'default' : 'ghost'}
              onClick={onClose}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </IconButton>
          </header>

          <PlaylistEditorForm
            mode={mode}
            isSaving={isSaving}
            initial={initial}
            onCancel={onClose}
            onSave={async (payload) => {
              await onSave(payload);
              onClose();
            }}
          />
        </section>
      </div>
    );
  },
);

PlaylistEditorDialog.displayName = 'PlaylistEditorDialog';
