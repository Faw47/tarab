import { clsx } from 'clsx';
import {
  ArrowLeft,
  ArrowUpDown,
  Clipboard,
  ClipboardCheck,
  Edit2,
  FolderOpen,
  ListPlus,
  Move,
  RotateCcw,
  Save,
  Search,
  // Music2,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizePath } from '../../lib/path-utils';
import { useRenderLog } from '../../lib/performance';
import { reportError } from '../../lib/report-error';
import {
  getCoverArtData,
  pickCoverArt,
  readFullTags,
  removeCoverArt,
  selectFolder,
  writeTags,
  writeTagsBatch,
} from '../../lib/tauri-commands';
import { refreshTracksByFilePaths } from '../../lib/track-refresh';
import type { ContextMenuPosition, TagInfo, TagUpdate, Track } from '../../types';
import { PlaylistPickerDialog } from '../playlist/PlaylistPickerDialog';
import { VirtualizedList } from '../shared/VirtualizedList';
import { ConfirmDialog, type ConfirmDialogProps } from '../ui/ConfirmDialog';

import { InputDialog, type InputDialogProps } from '../ui/InputDialog';
import { TagManagerMetadataFields } from './TagManagerMetadataFields';
import { TagManagerToolbar } from './TagManagerToolbar';
import { TagManagerTrackRow } from './TagManagerTrackRow';
import {
  buildFolderTree,
  type FileFilter,
  filterAndSortTracks,
  getSelectedFolderName,
  type SortColumn,
  type SortDirection,
} from './tag-manager-model';
import {
  type EditableTagValue,
  getEditableTagValue,
  mapWithConcurrency,
  type PendingTagUpdate,
  pickEditableTags,
  setTagUpdateField,
  TAG_FIELDS,
  type TagEditKey,
  type TagEditState,
  tagEditStateToUpdate,
  tagValuesEqual,
} from './tag-manager-mutations';
import { useTagManagerLibraryTracks } from './useTagManagerLibraryTracks';
import { useTagManagerSelection } from './useTagManagerSelection';
import './tag-manager.css';

interface TagManagerViewProps {
  selectedTracks: Track[];
  onSelectionChange: (tracks: Track[]) => void;
  onToggleTrack: (track: Track, isMulti: boolean) => void;
  onOpenTagEditor: (tracks: Track[]) => void;
  onRevealFiles: (tracks: Track[]) => void;
  onCopyMetadata: (track: Track) => Promise<void> | void;
  onPasteMetadata: (tracks: Track[]) => Promise<void> | void;
  onTrackContextMenu?: (track: Track, position: ContextMenuPosition) => void;
  onRenameTrack: (track: Track, newName: string) => Promise<void>;
  onMoveTracks: (tracks: Track[], destination: string) => Promise<void>;
  onDeleteFiles: (tracks: Track[]) => Promise<void> | void;
  onRemoveTracks?: (tracks: Track[]) => void;
  onScrollChange?: (scrolled: boolean) => void;
}

type CoverArtAction =
  | { kind: 'none' }
  | { kind: 'set'; base64: string; mime: string; previewDataUrl: string }
  | { kind: 'remove' };

type ConfirmModalState = Omit<ConfirmDialogProps, 'onCancel'> | null;

type UndoCoverArt = {
  base64: string;
  mime: string;
};

type UndoSnapshot = {
  expiresAt: number;
  label: string;
  items: Array<{ filePath: string; restore: TagEditState; coverArt?: UndoCoverArt | null }>;
};

export const TagManagerView = ({
  selectedTracks,
  onSelectionChange,
  onToggleTrack,
  onRevealFiles,
  onTrackContextMenu,
  onDeleteFiles,
  onRemoveTracks,
  onCopyMetadata,
  onPasteMetadata,
  onRenameTrack,
  onMoveTracks,
  onScrollChange,
}: TagManagerViewProps) => {
  useRenderLog('TagManagerView');
  const {
    tracks: allTracks,
    loadedCount: hydrationLoadedCount,
    totalCount: hydrationTotalCount,
    isHydrating: isLibraryHydrating,
    hydrationError: libraryHydrationError,
    retryHydration,
  } = useTagManagerLibraryTracks();
  // Toolbar UI
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [fileFilter, setFileFilter] = useState<FileFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Dropdown refs
  const sourceDropdownRef = useRef<HTMLDivElement | null>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [showNarrowEditor, setShowNarrowEditor] = useState(false);

  // Editor
  const [edited, setEdited] = useState<TagEditState>({});
  const [applyFields, setApplyFields] = useState<Record<TagEditKey, boolean>>(() => {
    const init = {} as Record<TagEditKey, boolean>;
    for (const f of TAG_FIELDS) init[f.key] = false;
    return init;
  });
  const [originalTags, setOriginalTags] = useState<TagInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [coverArtPreview, setCoverArtPreview] = useState<string | null>(null);
  const [coverArtAction, setCoverArtAction] = useState<CoverArtAction>({ kind: 'none' });

  const [inputDialog, setInputDialog] = useState<Omit<InputDialogProps, 'onCancel'> | null>(null);

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>(null);
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);

  // Load race protection
  const loadReqId = useRef(0);

  // Virtual list
  const ROW_H = 52;

  // Debounce query
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryInput), 150);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  // Close dropdowns on outside click + Esc
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;

      if (
        showSourceDropdown &&
        sourceDropdownRef.current &&
        !sourceDropdownRef.current.contains(t)
      ) {
        setShowSourceDropdown(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showSourceDropdown) {
        sourceTriggerRef.current?.focus();
      }
      setShowSourceDropdown(false);
      setConfirmModal(null);
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showSourceDropdown]);

  const handleSourceMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setShowSourceDropdown(false);
      sourceTriggerRef.current?.focus();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      items[(Math.max(0, current) + offset + items.length) % items.length]?.focus();
    }
  }, []);

  // Undo expiry
  useEffect(() => {
    if (!undo) return;
    const ms = Math.max(0, undo.expiresAt - Date.now());
    const t = window.setTimeout(() => setUndo(null), ms);
    return () => window.clearTimeout(t);
  }, [undo]);

  const folderTree = useMemo(() => buildFolderTree(allTracks), [allTracks]);
  useEffect(() => {
    if (isLibraryHydrating || libraryHydrationError || !selectedFolder) return;
    if (!folderTree.some((folder) => folder.path === selectedFolder)) {
      setSelectedFolder(null);
    }
  }, [folderTree, isLibraryHydrating, libraryHydrationError, selectedFolder]);
  const selectedFolderName = useMemo(
    () => getSelectedFolderName(folderTree, selectedFolder),
    [folderTree, selectedFolder],
  );
  const filteredTracks = useMemo(
    () =>
      filterAndSortTracks({
        tracks: allTracks,
        selectedFolder,
        query,
        fileFilter,
        sortColumn,
        sortDirection,
      }),
    [allTracks, fileFilter, query, selectedFolder, sortColumn, sortDirection],
  );

  const closeSelectionSurfaces = useCallback(() => {
    setShowSourceDropdown(false);
    setShowPlaylistPicker(false);
    setConfirmModal(null);
  }, []);
  const {
    allSelected,
    focusedIndex,
    handleRowClick,
    handleTableKeyDown,
    handleToggleAll,
    idToIndex,
    scrollToIndexNearest,
    scrollToIndexRef,
    selectedSet,
    setSelectionAnchor,

    setFocusedIndex,
  } = useTagManagerSelection({
    filteredTracks,
    selectedTracks,
    onSelectionChange,
    onToggleTrack,
    onEscape: closeSelectionSurfaces,
    allowSelectAll: !isLibraryHydrating,
  });

  // Load tags when selection changes
  useEffect(() => {
    loadReqId.current += 1;
    if (selectedTracks.length === 1) {
      const t = selectedTracks[0];
      const idx = idToIndex.get(t.id);
      if (typeof idx === 'number') {
        setFocusedIndex(idx);
        setSelectionAnchor(idx);
        scrollToIndexNearest(idx);
      }
      loadSingleTrackTags(t);
    } else {
      setShowNarrowEditor(false);
      setIsLoading(false);
      setOriginalTags(null);
      setEdited({});
      setCoverArtPreview(null);
      setCoverArtAction({ kind: 'none' });

      setApplyFields(() => {
        const init = {} as Record<TagEditKey, boolean>;
        for (const f of TAG_FIELDS) init[f.key] = false;
        return init;
      });

      if (selectedTracks.length === 0) setSelectionAnchor(null);
    }
    return () => {
      loadReqId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTracks]);

  const loadSingleTrackTags = async (track: Track) => {
    const reqId = ++loadReqId.current;
    setIsLoading(true);

    try {
      const tags = await readFullTags(track.filePath);
      if (reqId !== loadReqId.current) return;

      setOriginalTags(tags);

      const next = pickEditableTags(tags);

      setEdited(next);

      setApplyFields(() => {
        const init = {} as Record<TagEditKey, boolean>;
        for (const f of TAG_FIELDS) init[f.key] = true;
        return init;
      });

      setCoverArtPreview(null);
      setCoverArtAction({ kind: 'none' });
    } catch (err) {
      if (reqId !== loadReqId.current) return;
      reportError('Failed to load tags', { source: 'tag-manager-view', error: err });
    } finally {
      if (reqId === loadReqId.current) setIsLoading(false);
    }
  };

  // Helpers
  const isMulti = selectedTracks.length > 1;

  const setApplyField = (key: TagEditKey, on: boolean) => {
    setApplyFields((prev) => ({ ...prev, [key]: on }));
  };

  const setField = (key: TagEditKey, value: EditableTagValue) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
    if (isMulti) setApplyField(key, true);
  };

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const sortGlyph = (col: SortColumn) => (
    <ArrowUpDown
      className={clsx('w-3 h-3', sortColumn === col ? 'text-primary' : 'text-white/30')}
    />
  );

  // Cover art change, preserves MIME
  const handleCoverArtChange = async () => {
    try {
      const selected = await pickCoverArt();
      if (!selected) return;
      const previewDataUrl = `data:${selected.mime};base64,${selected.base64}`;
      setCoverArtAction({ kind: 'set', ...selected, previewDataUrl });
      setCoverArtPreview(previewDataUrl);
    } catch (error) {
      reportError('Failed to select cover art', { source: 'tag-manager-view', error });
    }
  };

  const handleStageRemoveCoverArt = () => {
    setCoverArtAction({ kind: 'remove' });
    setCoverArtPreview(null);
  };

  const handleRevert = () => {
    if (selectedTracks.length === 1 && originalTags) {
      setEdited(pickEditableTags(originalTags));

      setApplyFields(() => {
        const init = {} as Record<TagEditKey, boolean>;
        for (const f of TAG_FIELDS) init[f.key] = true;
        return init;
      });

      setCoverArtAction({ kind: 'none' });
      setCoverArtPreview(null);

      return;
    }

    // Multi: clear staged edits
    setEdited({});
    setApplyFields(() => {
      const init = {} as Record<TagEditKey, boolean>;
      for (const f of TAG_FIELDS) init[f.key] = false;
      return init;
    });
    setCoverArtAction({ kind: 'none' });
    setCoverArtPreview(null);
  };

  const hasChanges = useMemo(() => {
    if (selectedTracks.length === 0) return false;
    if (coverArtAction.kind !== 'none') return true;

    if (selectedTracks.length === 1 && originalTags) {
      for (const f of TAG_FIELDS) {
        const k = f.key;
        const newVal = edited[k];
        const oldVal = getEditableTagValue(originalTags, k);

        if (!tagValuesEqual(newVal, oldVal)) return true;
      }
      return false;
    }

    // Multi: each APPLY field with a value (string can be empty to clear)
    for (const f of TAG_FIELDS) {
      const k = f.key;
      if (!applyFields[k]) continue;
      const v = edited[k];
      if (f.kind === 'number') {
        if ((typeof v === 'number' && Number.isFinite(v)) || v === null) return true;
      } else {
        if (typeof v === 'string' || v === null) return true;
      }
    }

    return false;
  }, [applyFields, coverArtAction.kind, edited, originalTags, selectedTracks.length]);

  const buildUpdatesForSave = useCallback(() => {
    const updates: PendingTagUpdate = {};

    if (selectedTracks.length === 1 && originalTags) {
      for (const f of TAG_FIELDS) {
        const k = f.key;
        const newVal = edited[k];
        const oldVal = getEditableTagValue(originalTags, k);

        if (!tagValuesEqual(newVal, oldVal)) {
          setTagUpdateField(updates, k, newVal);
        }
      }
    } else {
      for (const f of TAG_FIELDS) {
        const k = f.key;
        if (!applyFields[k]) continue;

        const v = edited[k];
        if (f.kind === 'number') {
          if ((typeof v === 'number' && Number.isFinite(v)) || v === null) {
            setTagUpdateField(updates, k, v);
          }
        } else {
          if (typeof v === 'string' || v === null) {
            setTagUpdateField(updates, k, v);
          }
        }
      }
    }

    if (coverArtAction.kind === 'set') {
      updates.coverArtBase64 = coverArtAction.base64;
      updates.coverArtMime = coverArtAction.mime;
    }

    return updates as TagUpdate;
  }, [applyFields, coverArtAction, edited, originalTags, selectedTracks.length]);

  const computeSaveSummary = useCallback(() => {
    const updates = buildUpdatesForSave();
    const fields: string[] = [];

    for (const f of TAG_FIELDS) {
      const k = f.key;
      if (updates[k] !== undefined) fields.push(f.label);
    }
    if (coverArtAction.kind === 'set') fields.push('Cover Art (set)');
    if (coverArtAction.kind === 'remove') fields.push('Cover Art (remove)');

    return { updates, fields };
  }, [buildUpdatesForSave, coverArtAction.kind]);

  const handleSaveImpl = async () => {
    if (selectedTracks.length === 0) return;

    const { updates } = computeSaveSummary();
    const hasAnyUpdates = Object.keys(updates).length > 0;
    const needsCoverRemove = coverArtAction.kind === 'remove';

    if (!hasAnyUpdates && !needsCoverRemove) return;

    setIsSaving(true);

    try {
      // Capture original artwork only when the save changes artwork so undo can restore it.
      const changedKeys = new Set<TagEditKey>();

      for (const f of TAG_FIELDS) {
        const k = f.key;
        if (updates[k] !== undefined) changedKeys.add(k);
      }

      const shouldSnapshotCoverArt = coverArtAction.kind !== 'none';
      const snapshotItems =
        changedKeys.size > 0 || shouldSnapshotCoverArt
          ? await mapWithConcurrency(selectedTracks, 8, async (t) => {
              const tags =
                selectedTracks.length === 1 && originalTags
                  ? originalTags
                  : await readFullTags(t.filePath);
              const restore: TagEditState = {};
              for (const k of changedKeys) restore[k] = getEditableTagValue(tags, k);
              const originalCoverArt = shouldSnapshotCoverArt
                ? await getCoverArtData(t.filePath)
                : undefined;
              return {
                filePath: t.filePath,
                restore,
                ...(shouldSnapshotCoverArt
                  ? {
                      coverArt: originalCoverArt
                        ? { mime: originalCoverArt[0], base64: originalCoverArt[1] }
                        : null,
                    }
                  : {}),
              };
            })
          : [];

      let successfulPaths = selectedTracks.map((track) => track.filePath);
      let failedPaths: string[] = [];

      if (Object.keys(updates).length > 0) {
        if (selectedTracks.length === 1) {
          const result = await writeTags(selectedTracks[0].filePath, updates);
          successfulPaths = result.status === 'success' ? [result.path] : [];
          failedPaths = result.status === 'failed' ? [result.path] : [];
        } else {
          const results = await writeTagsBatch(
            selectedTracks.map((t) => t.filePath),
            updates,
          );
          successfulPaths = results
            .filter((result) => result.status === 'success')
            .map((result) => result.path);
          failedPaths = results
            .filter((result) => result.status === 'failed')
            .map((result) => result.path);
        }
      }

      const changedPaths = new Set(successfulPaths);
      if (coverArtAction.kind === 'remove' && successfulPaths.length > 0) {
        const coverResults = await mapWithConcurrency(successfulPaths, 8, async (filePath) => {
          try {
            await removeCoverArt(filePath);
            return { filePath, success: true } as const;
          } catch (error) {
            reportError('Failed to remove cover art', {
              source: 'tag-manager-view',
              error,
            });
            return { filePath, success: false } as const;
          }
        });
        const coverFailures = coverResults
          .filter((result) => !result.success)
          .map((result) => result.filePath);
        failedPaths = Array.from(new Set([...failedPaths, ...coverFailures]));
      }

      const successfulSet = new Set(successfulPaths);
      const successfulSnapshots = snapshotItems.filter((item) => successfulSet.has(item.filePath));
      if (successfulSnapshots.length > 0) {
        setUndo({
          expiresAt: Date.now() + 10_000,
          label:
            successfulSnapshots.length === 1
              ? 'Saved changes (undo available)'
              : `Saved changes to ${successfulSnapshots.length} tracks (undo available)`,
          items: successfulSnapshots,
        });
      }

      if (changedPaths.size > 0) {
        await refreshTracksByFilePaths(Array.from(changedPaths));
      }
      if (failedPaths.length === 0) setCoverArtAction({ kind: 'none' });

      if (failedPaths.length > 0) {
        const failedSet = new Set(failedPaths);
        onSelectionChange(selectedTracks.filter((track) => failedSet.has(track.filePath)));
        reportError(`Failed to save all changes for ${failedPaths.length} file(s)`, {
          source: 'tag-manager-view',
          error: new Error('One or more tag updates failed. Failed rows remain selected.'),
        });
      } else if (selectedTracks.length === 1) {
        await loadSingleTrackTags(selectedTracks[0]);
      } else {
        setEdited({});
        setApplyFields(() => {
          const init = {} as Record<TagEditKey, boolean>;
          for (const f of TAG_FIELDS) init[f.key] = false;
          return init;
        });
      }
    } catch (err) {
      reportError('Failed to save tags', { source: 'tag-manager-view', error: err });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (selectedTracks.length === 0 || !hasChanges || isSaving) return;

    const { fields } = computeSaveSummary();
    const needsConfirm = selectedTracks.length > 1 || coverArtAction.kind !== 'none';
    if (!needsConfirm) {
      await handleSaveImpl();
      return;
    }

    const count = selectedTracks.length;

    setConfirmModal({
      title: 'Confirm Save',
      confirmLabel: count === 1 ? 'Save' : `Save to ${count} tracks`,
      message: `You are about to update ${count} track${count === 1 ? '' : 's'}.${
        count > 1 ? ' Only explicitly enabled fields will be applied.' : ''
      }`,
      detail: fields.length ? `Changes: ${fields.join(', ')}` : 'No changes detected',
      onConfirm: async () => {
        setConfirmModal(null);
        await handleSaveImpl();
      },
    });
  };

  const handleUndo = async () => {
    if (!undo) return;
    const snapshot = undo;
    setUndo(null);

    const outcomes = await mapWithConcurrency(snapshot.items, 8, async (it) => {
      try {
        const restoreUpdate = tagEditStateToUpdate(it.restore);
        if (it.coverArt) {
          restoreUpdate.coverArtBase64 = it.coverArt.base64;
          restoreUpdate.coverArtMime = it.coverArt.mime;
        }

        if (Object.keys(restoreUpdate).length > 0) {
          const result = await writeTags(it.filePath, restoreUpdate);
          if (result.status !== 'success') {
            throw new Error(result.errorMessage ?? 'Tarab could not restore the track tags.');
          }
        }
        if (it.coverArt === null) {
          await removeCoverArt(it.filePath);
        }
        return { item: it, status: 'success' as const };
      } catch (error) {
        return { item: it, status: 'failed' as const, error };
      }
    });
    const succeeded = outcomes.filter(
      (outcome): outcome is NonNullable<typeof outcome> & { status: 'success' } =>
        Boolean(outcome) && outcome.status === 'success',
    );
    const failed = outcomes.filter(
      (outcome): outcome is NonNullable<typeof outcome> & { status: 'failed'; error: unknown } =>
        Boolean(outcome) && outcome.status === 'failed',
    );

    if (succeeded.length > 0) {
      await refreshTracksByFilePaths(succeeded.map((outcome) => outcome.item.filePath));
    }
    if (failed.length > 0) {
      const failedPaths = new Set(failed.map((outcome) => outcome.item.filePath));
      onSelectionChange(selectedTracks.filter((track) => failedPaths.has(track.filePath)));
      setUndo({
        expiresAt: Date.now() + 10_000,
        label: `Undo failed for ${failed.length} file${failed.length === 1 ? '' : 's'} (retry available)`,
        items: failed.map((outcome) => outcome.item),
      });
      reportError(
        `${succeeded.length} file(s) restored; ${failed.length} file(s) could not be restored`,
        {
          source: 'tag-manager-view',
          error: failed
            .map((outcome) =>
              outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
            )
            .join('; '),
        },
      );
      return;
    }

    if (selectedTracks.length === 1) await loadSingleTrackTags(selectedTracks[0]);
  };

  const requestDeleteFiles = () => {
    if (selectedTracks.length === 0) return;

    const count = selectedTracks.length;
    const sample = selectedTracks
      .slice(0, 6)
      .map((t) => normalizePath(t.filePath).split('/').pop() || t.title || t.id);

    setConfirmModal({
      title: 'Move Files to Trash',
      confirmLabel: count === 1 ? 'Move File to Trash' : `Move ${count} Files to Trash`,
      message: `Tarab will move ${count} file${count === 1 ? '' : 's'} to recoverable Trash.`,
      detail: `Example files: ${sample.join(', ')}${
        count > sample.length ? `, and ${count - sample.length} more` : ''
      }`,
      onConfirm: async () => {
        setConfirmModal(null);
        await onDeleteFiles(selectedTracks);
      },
    });
  };

  const showTotalDiscs = useMemo(() => {
    if (originalTags?.totalDiscs != null) return true;
    if (edited.totalDiscs != null) return true;
    return false;
  }, [edited.totalDiscs, originalTags]);

  return (
    <div
      className="tag-manager-view h-full relative overflow-hidden bg-background flex flex-col"
      aria-busy={isLibraryHydrating || undefined}
    >
      {/* Undo Toast */}
      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]">
          <div className="tag-manager-undo-surface rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl px-4 py-3 shadow-2xl shadow-black/40 flex items-center gap-4">
            <div className="text-sm text-text-primary">{undo.label}</div>
            <button
              onClick={handleUndo}
              className="px-3 py-1.5 rounded-xl bg-white text-black text-xs font-bold hover:scale-[1.02] active:scale-[0.98] transition-transform"
            >
              Undo
            </button>
            <button
              onClick={() => setUndo(null)}
              className="p-2 rounded-xl bg-white/5 text-text-secondary hover:bg-white/10 hover:text-white transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {confirmModal && <ConfirmDialog {...confirmModal} onCancel={() => setConfirmModal(null)} />}
      <TagManagerToolbar
        allSelected={allSelected}
        fileFilter={fileFilter}
        filteredTrackCount={filteredTracks.length}
        folderTree={folderTree}
        handleSourceMenuKeyDown={handleSourceMenuKeyDown}
        hydrationError={libraryHydrationError}
        hydrationLoadedCount={hydrationLoadedCount}
        hydrationTotalCount={hydrationTotalCount}
        isLibraryHydrating={isLibraryHydrating}
        queryInput={queryInput}
        retryHydration={retryHydration}
        selectedFolder={selectedFolder}
        selectedFolderName={selectedFolderName}
        selectedTrackCount={selectedTracks.length}
        setFileFilter={setFileFilter}
        setQueryInput={setQueryInput}
        setSelectedFolder={setSelectedFolder}
        setShowNarrowEditor={setShowNarrowEditor}
        setShowSourceDropdown={setShowSourceDropdown}
        showSourceDropdown={showSourceDropdown}
        sourceDropdownRef={sourceDropdownRef}
        sourceTriggerRef={sourceTriggerRef}
        handleToggleAll={handleToggleAll}
      />{' '}
      {/* Main Content */}
      <div className="tag-manager-content flex-1 flex overflow-hidden">
        {/* Table */}
        <div
          className={clsx(
            'min-w-0 flex-1 flex-col bg-background/50',
            showNarrowEditor && selectedTracks.length > 0 ? 'hidden lg:flex' : 'flex',
          )}
        >
          <div className="tag-manager-table-header shrink-0 grid grid-cols-[32px_40px_minmax(0,1fr)] sm:grid-cols-[40px_48px_1.5fr_1fr_1fr_60px_70px] gap-2 px-4 py-2 border-b border-white/5 text-xs font-bold uppercase tracking-widest text-text-subtle bg-white/[0.02]">
            <span className="text-center">#</span>
            <span />
            <button
              onClick={() => handleSort('title')}
              className="text-left hover:text-primary flex items-center gap-2"
            >
              Title {sortGlyph('title')}
            </button>
            <button
              className="hidden items-center gap-2 text-left hover:text-primary sm:flex"
              onClick={() => handleSort('artist')}
            >
              Artist {sortGlyph('artist')}
            </button>
            <button
              className="hidden items-center gap-2 text-left hover:text-primary sm:flex"
              onClick={() => handleSort('album')}
            >
              Album {sortGlyph('album')}
            </button>
            <button
              className="hidden items-center justify-end gap-2 text-right hover:text-primary sm:flex"
              onClick={() => handleSort('year')}
            >
              Year {sortGlyph('year')}
            </button>
            <button
              className="hidden items-center justify-end gap-2 text-right hover:text-primary sm:flex"
              onClick={() => handleSort('duration')}
            >
              Time {sortGlyph('duration')}
            </button>
          </div>

          {filteredTracks.length === 0 ? (
            <div className="tag-manager-empty flex-1 flex flex-col items-center justify-center text-text-muted gap-4">
              <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center">
                <Search className="w-8 h-8 opacity-20" />
              </div>
              <p>No tracks match your filters</p>
            </div>
          ) : (
            <VirtualizedList
              items={filteredTracks}
              itemHeight={ROW_H}
              overscan={8}
              className="flex-1 overflow-y-auto custom-scrollbar outline-none"
              getItemKey={(track) => track.id}
              scrollToIndexRef={scrollToIndexRef}
              containerProps={{
                tabIndex: 0,
                onKeyDown: handleTableKeyDown,
                role: 'listbox',
                'aria-label': 'Tracks available for tag editing',
                'aria-multiselectable': true,
                'aria-activedescendant':
                  focusedIndex >= 0
                    ? `tag-manager-track-${filteredTracks[focusedIndex]?.id}`
                    : undefined,
                title:
                  'Keyboard: Up/Down to move, Space toggle, Enter select, Cmd/Ctrl+A select all',
              }}
              onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop > 8)}
              renderItem={(track, index) => {
                const isSelected = selectedSet.has(track.id);
                const isFocused = index === focusedIndex;

                return (
                  <TagManagerTrackRow
                    track={track}
                    index={index}
                    height={ROW_H}
                    isSelected={isSelected}
                    isFocused={isFocused}
                    onSelect={(event) => handleRowClick(track, event, index)}
                    onContextMenu={onTrackContextMenu}
                    onReplaceSelection={onSelectionChange}
                  />
                );
              }}
            />
          )}
        </div>

        {/* Right Editor Panel */}
        <div
          className={clsx(
            'tag-manager-editor w-full shrink-0 flex-col border-l border-white/10 bg-background lg:w-[400px]',
            showNarrowEditor && selectedTracks.length > 0 ? 'flex' : 'hidden lg:flex',
          )}
        >
          {!selectedTracks.length ? (
            <div className="tag-manager-empty flex-1 flex flex-col items-center justify-center text-text-muted p-10 text-center">
              <Edit2 className="w-12 h-12 mb-4 opacity-40" />
              <p>Select tracks to edit</p>
            </div>
          ) : isLoading ? (
            <div
              className="flex-1 flex items-center justify-center"
              role="status"
              aria-label="Loading selected track metadata"
            >
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="tag-manager-editor-header p-4 border-b border-white/5 flex items-center justify-between gap-3 bg-white/[0.02]">
                <button
                  type="button"
                  onClick={() => setShowNarrowEditor(false)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-text-secondary hover:bg-white/10 hover:text-white lg:hidden"
                  aria-label="Back to track list"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-bold text-text-subtle uppercase">
                  {selectedTracks.length > 1
                    ? `Editing ${selectedTracks.length} tracks`
                    : 'Track Properties'}
                </span>
                {hasChanges && (
                  <span className="text-xs bg-[var(--state-warning-surface)] text-[var(--state-warning-ink)] px-2 py-0.5 rounded border border-[var(--state-warning-border)]">
                    UNSAVED
                  </span>
                )}
              </div>

              <div className="tag-manager-editor flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
                <TagManagerMetadataFields
                  selectedTracks={selectedTracks}
                  originalTags={originalTags}
                  edited={edited}
                  applyFields={applyFields}
                  isMulti={isMulti}
                  showTotalDiscs={showTotalDiscs}
                  coverArtPreview={coverArtPreview}
                  coverArtActionKind={coverArtAction.kind}
                  onCoverArtChange={handleCoverArtChange}
                  onStageRemoveCoverArt={handleStageRemoveCoverArt}
                  onSetField={setField}
                  onSetApplyField={setApplyField}
                />
                {/* File ops */}
                <div className="pt-4 border-t border-white/10 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        if (selectedTracks.length === 1) onCopyMetadata(selectedTracks[0]);
                      }}
                      disabled={selectedTracks.length !== 1}
                      className="tag-manager-file-action flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Clipboard className="w-3.5 h-3.5" /> Copy Tags
                    </button>
                    <button
                      onClick={() => onPasteMetadata(selectedTracks)}
                      disabled={selectedTracks.length === 0}
                      className="tag-manager-file-action flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" /> Paste Tags
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => onRevealFiles(selectedTracks)}
                      disabled={selectedTracks.length === 0}
                      className="tag-manager-file-action flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> Reveal File
                    </button>

                    <button
                      onClick={requestDeleteFiles}
                      disabled={selectedTracks.length === 0}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg bg-[var(--state-error-surface)] hover:bg-[var(--state-error-surface)] text-xs text-[var(--state-error-ink)] border border-[var(--state-error-border)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete File
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const folder = await selectFolder();
                          if (folder && selectedTracks.length > 0) {
                            await onMoveTracks(selectedTracks, folder);
                          }
                        } catch (error) {
                          reportError('Failed to move selected tracks', {
                            source: 'tag-manager-view',
                            error,
                          });
                        }
                      }}
                      disabled={selectedTracks.length === 0}
                      className="tag-manager-file-action flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Move className="w-3.5 h-3.5" /> Move
                    </button>

                    {onRemoveTracks ? (
                      <button
                        onClick={() => onRemoveTracks(selectedTracks)}
                        disabled={selectedTracks.length === 0}
                        className="tag-manager-file-action flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <X className="w-3.5 h-3.5" /> Remove
                      </button>
                    ) : (
                      <div className="opacity-0 pointer-events-none" />
                    )}
                  </div>

                  <button
                    onClick={() => setShowPlaylistPicker(true)}
                    disabled={selectedTracks.length === 0}
                    className="w-full tag-manager-file-action flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ListPlus className="w-3.5 h-3.5" /> Add to Playlist
                  </button>
                </div>
              </div>

              {/* Footer actions */}
              <div className="tag-manager-footer p-4 bg-[#0a0a0a] border-t border-white/10 shrink-0 space-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    className="tag-manager-save flex-1 py-3 rounded-lg bg-white text-black font-bold text-sm shadow hover:scale-[1.01] active:scale-[0.99] transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                  >
                    <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={handleRevert}
                    disabled={!hasChanges}
                    className="tag-manager-icon-button p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Revert staged changes"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

                <PlaylistPickerDialog
                  open={showPlaylistPicker}
                  trackIds={selectedTracks.map((track) => track.id)}
                  onClose={() => setShowPlaylistPicker(false)}
                />

                {/* Rename (single track only) */}
                <button
                  onClick={() => {
                    if (selectedTracks.length !== 1) return;
                    const track = selectedTracks[0];
                    const currentName =
                      normalizePath(track.filePath).split('/').pop() || track.title;
                    setInputDialog({
                      title: 'Rename file',
                      label: 'New filename',
                      initialValue: currentName,
                      submitLabel: 'Rename',
                      onSubmit: (newName) => {
                        if (newName !== currentName) onRenameTrack(track, newName);
                      },
                    });
                  }}
                  disabled={selectedTracks.length !== 1}
                  className="w-full tag-manager-file-action flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Rename File
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {inputDialog && (
        <InputDialog
          title={inputDialog.title}
          label={inputDialog.label}
          initialValue={inputDialog.initialValue}
          placeholder={inputDialog.placeholder}
          submitLabel={inputDialog.submitLabel}
          onSubmit={inputDialog.onSubmit}
          onCancel={() => setInputDialog(null)}
        />
      )}
    </div>
  );
};

TagManagerView.displayName = 'TagManagerView';
