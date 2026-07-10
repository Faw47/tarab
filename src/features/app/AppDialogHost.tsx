import { lazy, memo, Suspense } from 'react';
import { PlaylistPickerDialog } from '../../components/playlist/PlaylistPickerDialog';
import { ContextMenu, type ContextMenuItem } from '../../components/shared/ContextMenu';
import { ConfirmDialog, type ConfirmDialogProps } from '../../components/ui/ConfirmDialog';
import type { ContextMenuPosition, Track } from '../../types';

const TagEditorModal = lazy(() =>
  import('../../components/tageditor/TagEditorModal').then((mod) => ({
    default: mod.TagEditorModal,
  })),
);

export interface AppDialogHostProps {
  tagEditorTracks: Track[] | null;
  onCloseTagEditor: () => void;
  onSaveTagEditor: () => void;
  playlistPickerOpen: boolean;
  playlistPickerTrackIds: string[];
  onClosePlaylistPicker: () => void;
  contextMenuPosition: ContextMenuPosition | null;
  contextMenuItems: ContextMenuItem[];
  onCloseContextMenu: () => void;
  confirmDialog: Omit<ConfirmDialogProps, 'onCancel'> | null;
  onCancelConfirmDialog: () => void;
}

export const AppDialogHost = memo(function AppDialogHost({
  tagEditorTracks,
  onCloseTagEditor,
  onSaveTagEditor,
  playlistPickerOpen,
  playlistPickerTrackIds,
  onClosePlaylistPicker,
  contextMenuPosition,
  contextMenuItems,
  onCloseContextMenu,
  confirmDialog,
  onCancelConfirmDialog,
}: AppDialogHostProps) {
  return (
    <>
      {tagEditorTracks ? (
        <Suspense fallback={null}>
          <TagEditorModal
            tracks={tagEditorTracks}
            onClose={onCloseTagEditor}
            onSave={onSaveTagEditor}
          />
        </Suspense>
      ) : null}

      <PlaylistPickerDialog
        open={playlistPickerOpen}
        trackIds={playlistPickerTrackIds}
        onClose={onClosePlaylistPicker}
      />

      <ContextMenu
        position={contextMenuPosition}
        items={contextMenuItems}
        onClose={onCloseContextMenu}
      />

      {confirmDialog ? <ConfirmDialog {...confirmDialog} onCancel={onCancelConfirmDialog} /> : null}
    </>
  );
});
