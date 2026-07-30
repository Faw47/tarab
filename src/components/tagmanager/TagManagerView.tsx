import { clsx } from 'clsx';
import {
  ArrowUpDown,
  CheckSquare,
  ChevronDown,
  Clipboard,
  ClipboardCheck,
  Edit2,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Library,
  ListPlus,
  Move,
  RotateCcw,
  Save,
  Search,
  Square,
  // Music2,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizePath } from '../../lib/path-utils';
import { useRenderLog } from '../../lib/performance';
import { reportError } from '../../lib/report-error';
import {
  readFullTags,
  removeCoverArt,
  selectFolder,
  writeTags,
  writeTagsBatch,
} from '../../lib/tauri-commands';
import { refreshTracksByFilePaths } from '../../lib/track-refresh';
import type { ContextMenuPosition, TagInfo, TagUpdate, Track } from '../../types';
import { PlaylistPickerDialog } from '../playlist/PlaylistPickerDialog';
import { CoverArtImage } from '../shared/CoverArtImage';
import { VirtualizedList } from '../shared/VirtualizedList';
import { ConfirmDialog, type ConfirmDialogProps } from '../ui/ConfirmDialog';
import { InputDialog, type InputDialogProps } from '../ui/InputDialog';
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

type UndoSnapshot = {
  expiresAt: number;
  label: string;
  items: Array<{ filePath: string; restore: TagEditState }>;
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
    selectionAnchorIndexRef,
    setFocusedIndex,
  } = useTagManagerSelection({
    filteredTracks,
    selectedTracks,
    onSelectionChange,
    onToggleTrack,
    onEscape: closeSelectionSurfaces,
  });

  // Load tags when selection changes
  useEffect(() => {
    if (selectedTracks.length === 1) {
      const t = selectedTracks[0];
      const idx = idToIndex.get(t.id);
      if (typeof idx === 'number') {
        setFocusedIndex(idx);
        selectionAnchorIndexRef.current = idx;
        scrollToIndexNearest(idx);
      }
      loadSingleTrackTags(t);
    } else {
      setOriginalTags(null);
      setEdited({});
      setCoverArtPreview(null);
      setCoverArtAction({ kind: 'none' });

      setApplyFields(() => {
        const init = {} as Record<TagEditKey, boolean>;
        for (const f of TAG_FIELDS) init[f.key] = false;
        return init;
      });

      if (selectedTracks.length === 0) selectionAnchorIndexRef.current = null;
    }
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
      reportError('Failed to load tags', { source: 'tag-manager-view', error: err });
    } finally {
      if (reqId === loadReqId.current) setIsLoading(false);
    }
  };

  // Helpers
  const isMulti = selectedTracks.length > 1;

  const parseNumberOrNull = (raw: string) => {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

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
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
        const mime =
          file.type || (dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg');
        setCoverArtAction({ kind: 'set', base64, mime, previewDataUrl: dataUrl });
        setCoverArtPreview(dataUrl);
      };
      reader.readAsDataURL(file);
    };
    input.click();
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
      // Snapshot for undo (tag fields only)
      const changedKeys = new Set<TagEditKey>();

      for (const f of TAG_FIELDS) {
        const k = f.key;
        if (updates[k] !== undefined) changedKeys.add(k);
      }

      const snapshotItems =
        changedKeys.size > 0
          ? await mapWithConcurrency(selectedTracks, 8, async (t) => {
              const tags =
                selectedTracks.length === 1 && originalTags
                  ? originalTags
                  : await readFullTags(t.filePath);
              const restore: TagEditState = {};
              for (const k of changedKeys) restore[k] = getEditableTagValue(tags, k);
              return { filePath: t.filePath, restore };
            })
          : [];

      // Cover art remove
      if (coverArtAction.kind === 'remove') {
        await mapWithConcurrency(selectedTracks, 8, async (t) => removeCoverArt(t.filePath));
      }

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

      if (successfulPaths.length > 0) {
        await refreshTracksByFilePaths(successfulPaths);
      }
      setCoverArtAction({ kind: 'none' });

      if (failedPaths.length > 0) {
        const failedSet = new Set(failedPaths);
        onSelectionChange(selectedTracks.filter((track) => failedSet.has(track.filePath)));
        reportError(`Failed to save tags for ${failedPaths.length} file(s)`, {
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
        if (Object.keys(it.restore).length === 0) {
          return { item: it, status: 'success' as const };
        }
        const result = await writeTags(it.filePath, tagEditStateToUpdate(it.restore));
        if (result.status !== 'success') {
          throw new Error(result.errorMessage ?? 'Tarab could not restore the track tags.');
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

  // Render helpers
  const FieldLabel = ({ label, k }: { label: string; k: TagEditKey }) => {
    const applied = !isMulti ? true : !!applyFields[k];

    return (
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs uppercase text-text-subtle font-bold">{label}</label>
        {isMulti && (
          <button
            type="button"
            onClick={() => setApplyField(k, !applied)}
            className={clsx(
              'px-2 py-1 rounded-lg text-xs font-bold border transition-colors',
              applied
                ? 'bg-primary/20 text-primary border-primary/30'
                : 'bg-white/5 text-text-muted border-white/10 hover:bg-white/10',
            )}
            title={applied ? 'Applied to multi-edit' : 'Not applied to multi-edit'}
          >
            {applied ? 'APPLY' : 'SKIP'}
          </button>
        )}
      </div>
    );
  };

  const TextInput = ({ k, placeholder }: { k: TagEditKey; placeholder?: string }) => {
    const applied = !isMulti ? true : !!applyFields[k];
    return (
      <input
        value={typeof edited[k] === 'string' ? edited[k] : (edited[k] ?? '')}
        onChange={(e) => setField(k, e.target.value)}
        onFocus={() => {
          if (isMulti && !applied) setApplyField(k, true);
        }}
        disabled={isMulti && !applied}
        className="w-full bg-white/5 border border-white/5 rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:bg-black focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        placeholder={isMulti ? '(Multiple)' : placeholder}
      />
    );
  };
  const showTotalDiscs = useMemo(() => {
    if (originalTags?.totalDiscs != null) return true;
    if (edited.totalDiscs != null) return true;
    return false;
  }, [edited.totalDiscs, originalTags]);

  return (
    <div className="h-full relative overflow-hidden bg-background flex flex-col">
      {/* Undo Toast */}
      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]">
          <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl px-4 py-3 shadow-2xl shadow-black/40 flex items-center gap-4">
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
      {/* Slim Toolbar Header */}{' '}
      <div className="h-16 shrink-0 border-b border-white/5 bg-black/40 flex items-center px-4 gap-4 z-20 backdrop-blur-md">
        <div className="flex items-center gap-3 pr-4 border-r border-white/10">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Tag className="w-4 h-4 text-primary" />
          </div>
          <h1 className="text-lg font-bold text-white tracking-tight">Tag Editor</h1>
        </div>

        {/* Source Dropdown */}
        <div className="relative" ref={sourceDropdownRef}>
          <button
            ref={sourceTriggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowSourceDropdown((v) => !v);
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors border border-white/5 min-w-[180px]"
            aria-haspopup="menu"
            aria-expanded={showSourceDropdown}
            aria-label={`Library source: ${selectedFolderName}`}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              setShowSourceDropdown(true);
              queueMicrotask(() => {
                const items =
                  sourceDropdownRef.current?.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitemradio"]',
                  );
                items?.[event.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
              });
            }}
          >
            {selectedFolder ? (
              <Folder className="w-4 h-4 text-primary" />
            ) : (
              <Library className="w-4 h-4 text-primary" />
            )}
            <span className="truncate max-w-[140px]">{selectedFolderName}</span>
            <ChevronDown className="w-3 h-3 ml-auto opacity-50" />
          </button>

          {showSourceDropdown && (
            <div
              className="absolute top-full left-0 mt-2 w-72 bg-[#1a1a1a] border border-white/10 rounded-xl py-1 shadow-2xl overflow-y-auto max-h-[420px] z-50 custom-scrollbar"
              role="menu"
              aria-label="Library source"
              onKeyDown={handleSourceMenuKeyDown}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selectedFolder === null}
                onClick={() => {
                  setSelectedFolder(null);
                  setShowSourceDropdown(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-sm"
              >
                <Library className="w-4 h-4 text-primary" />
                <span>All Library</span>
                <span className="ml-auto text-xs opacity-50">{allTracks.length}</span>
              </button>
              <div className="h-px bg-white/5 my-1" />
              {folderTree.map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedFolder === folder.path}
                  onClick={() => {
                    setSelectedFolder(folder.path);
                    setShowSourceDropdown(false);
                  }}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2 hover:bg-white/5 text-xs',
                    selectedFolder === folder.path ? 'text-primary' : 'text-text-secondary',
                  )}
                  title={folder.path}
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto opacity-50">{folder.trackCount}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-md group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-primary transition-colors" />
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search..."
            aria-label="Search tracks for tag editing"
            className="w-full bg-black/20 rounded-lg pl-9 pr-4 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 focus:bg-black/40 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] border border-white/5"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1 border border-white/5">
          {(['all', 'missing-art', 'untagged'] as FileFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setFileFilter(filter)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wide transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom]',
                fileFilter === filter
                  ? 'bg-white text-black shadow-sm'
                  : 'text-text-secondary hover:text-white',
              )}
            >
              {filter === 'all' ? 'all' : filter === 'missing-art' ? 'missing art' : 'untagged'}
            </button>
          ))}
        </div>

        {/* Stats + select all */}
        <div className="ml-auto flex items-center gap-3 pl-4 border-l border-white/10">
          <span className="text-xs text-text-muted">{filteredTracks.length} tracks</span>
          <button
            onClick={handleToggleAll}
            className="p-2 hover:bg-white/5 rounded-lg text-text-secondary hover:text-white transition-colors"
            title={allSelected ? 'Deselect all' : 'Select all'}
            aria-label={allSelected ? 'Deselect all tracks' : 'Select all tracks'}
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
      {isLibraryHydrating && hydrationTotalCount > hydrationLoadedCount && (
        <div
          className="shrink-0 border-b border-white/5 bg-black/30 px-4 py-2"
          role="status"
          aria-live="polite"
        >
          <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.12em] text-text-muted">
            <span>Loading full library for bulk editing</span>
            <span>
              {hydrationLoadedCount} / {hydrationTotalCount}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-[var(--motion-emphasis)]"
              style={{
                width: `${Math.round((hydrationLoadedCount / hydrationTotalCount) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Table */}
        <div className="flex-1 flex flex-col bg-background/50">
          <div className="shrink-0 grid grid-cols-[40px_48px_1.5fr_1fr_1fr_60px_70px] gap-2 px-4 py-2 border-b border-white/5 text-xs font-bold uppercase tracking-widest text-text-subtle bg-white/[0.02]">
            <span className="text-center">#</span>
            <span />
            <button
              onClick={() => handleSort('title')}
              className="text-left hover:text-primary flex items-center gap-2"
            >
              Title {sortGlyph('title')}
            </button>
            <button
              onClick={() => handleSort('artist')}
              className="text-left hover:text-primary flex items-center gap-2"
            >
              Artist {sortGlyph('artist')}
            </button>
            <button
              onClick={() => handleSort('album')}
              className="text-left hover:text-primary flex items-center gap-2"
            >
              Album {sortGlyph('album')}
            </button>
            <button
              onClick={() => handleSort('year')}
              className="text-right hover:text-primary flex items-center justify-end gap-2"
            >
              Year {sortGlyph('year')}
            </button>
            <button
              onClick={() => handleSort('duration')}
              className="text-right hover:text-primary flex items-center justify-end gap-2"
            >
              Time {sortGlyph('duration')}
            </button>
          </div>

          {filteredTracks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-4">
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
        <div className="w-[400px] shrink-0 border-l border-white/10 bg-[#121212] flex flex-col">
          {!selectedTracks.length ? (
            <div className="flex-1 flex flex-col items-center justify-center text-text-muted p-10 text-center opacity-40">
              <Edit2 className="w-12 h-12 mb-4" />
              <p>Select tracks to edit</p>
            </div>
          ) : isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <span className="text-xs font-bold text-text-subtle uppercase">
                  {selectedTracks.length > 1
                    ? `Editing ${selectedTracks.length} tracks`
                    : 'Track Properties'}
                </span>
                {hasChanges && (
                  <span className="text-xs bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
                    UNSAVED
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
                {/* Art + Core */}
                <div className="flex gap-4">
                  <div className="w-28 shrink-0 flex flex-col gap-2">
                    <div className="w-28 h-28 rounded-xl overflow-hidden bg-black relative group border border-white/10">
                      {coverArtPreview ? (
                        <img
                          src={coverArtPreview}
                          className="w-full h-full object-cover"
                          alt="Cover"
                        />
                      ) : coverArtAction.kind === 'remove' ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-white/20" />
                        </div>
                      ) : selectedTracks.length === 1 &&
                        (originalTags?.hasCoverArt ?? selectedTracks[0].hasCoverArt) ? (
                        <CoverArtImage
                          track={selectedTracks[0]}
                          className="w-full h-full"
                          imgClassName="w-full h-full object-cover"
                          roundedClassName=""
                          iconClassName="w-8 h-8 text-white/20"
                          alt="Cover"
                          lazy={false}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-white/20" />
                        </div>
                      )}

                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={handleCoverArtChange}
                          className="p-2 bg-white/10 rounded-full hover:bg-white/20"
                          title="Change artwork"
                        >
                          <Edit2 className="w-4 h-4 text-white" />
                        </button>
                        <button
                          onClick={handleStageRemoveCoverArt}
                          className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40"
                          title="Remove artwork (saved on Save)"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={handleCoverArtChange}
                      className="text-xs text-center text-text-secondary hover:text-white transition-colors"
                    >
                      Change Artwork...
                    </button>
                  </div>

                  <div className="flex-1 space-y-3">
                    {/* Title */}
                    <div className="space-y-1">
                      <FieldLabel label="Title" k="title" />
                      <TextInput k="title" placeholder="Title" />
                    </div>

                    {/* Artist */}
                    <div className="space-y-1">
                      <FieldLabel label="Artist" k="artist" />
                      <TextInput k="artist" placeholder="Artist" />
                    </div>

                    {/* Album */}
                    <div className="space-y-1">
                      <FieldLabel label="Album" k="album" />
                      <TextInput k="album" placeholder="Album" />
                    </div>
                  </div>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <FieldLabel label="A. Artist" k="albumArtist" />
                    <TextInput k="albumArtist" placeholder="Album Artist" />
                  </div>

                  <div className="space-y-1">
                    <FieldLabel label="Genre" k="genre" />
                    <TextInput k="genre" placeholder="Genre" />
                  </div>

                  <div className="space-y-1">
                    <FieldLabel label="Year" k="year" />
                    <input
                      type="number"
                      value={typeof edited.year === 'number' ? edited.year : (edited.year ?? '')}
                      onChange={(e) => setField('year', parseNumberOrNull(e.target.value))}
                      onFocus={() => {
                        if (isMulti && !applyFields.year) setApplyField('year', true);
                      }}
                      disabled={isMulti && !applyFields.year}
                      className="w-full bg-white/5 border border-white/5 rounded-lg px-2 py-1.5 text-xs text-text-primary focus:bg-black focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Numbers */}
                <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                  <div
                    className={clsx('grid gap-2', showTotalDiscs ? 'grid-cols-4' : 'grid-cols-3')}
                  >
                    <div className="space-y-1">
                      <FieldLabel label="Trk #" k="trackNumber" />
                      <input
                        type="number"
                        value={
                          typeof edited.trackNumber === 'number'
                            ? edited.trackNumber
                            : (edited.trackNumber ?? '')
                        }
                        onChange={(e) => setField('trackNumber', parseNumberOrNull(e.target.value))}
                        onFocus={() => {
                          if (isMulti && !applyFields.trackNumber)
                            setApplyField('trackNumber', true);
                        }}
                        disabled={isMulti && !applyFields.trackNumber}
                        className="w-full bg-black/40 border border-white/5 rounded px-2 py-1 text-xs text-center focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div className="space-y-1">
                      <FieldLabel label="Total" k="totalTracks" />
                      <input
                        type="number"
                        value={
                          typeof edited.totalTracks === 'number'
                            ? edited.totalTracks
                            : (edited.totalTracks ?? '')
                        }
                        onChange={(e) => setField('totalTracks', parseNumberOrNull(e.target.value))}
                        onFocus={() => {
                          if (isMulti && !applyFields.totalTracks)
                            setApplyField('totalTracks', true);
                        }}
                        disabled={isMulti && !applyFields.totalTracks}
                        className="w-full bg-black/40 border border-white/5 rounded px-2 py-1 text-xs text-center focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div className="space-y-1">
                      <FieldLabel label="Disc" k="discNumber" />
                      <input
                        type="number"
                        value={
                          typeof edited.discNumber === 'number'
                            ? edited.discNumber
                            : (edited.discNumber ?? '')
                        }
                        onChange={(e) => setField('discNumber', parseNumberOrNull(e.target.value))}
                        onFocus={() => {
                          if (isMulti && !applyFields.discNumber) setApplyField('discNumber', true);
                        }}
                        disabled={isMulti && !applyFields.discNumber}
                        className="w-full bg-black/40 border border-white/5 rounded px-2 py-1 text-xs text-center focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>

                    {showTotalDiscs && (
                      <div className="space-y-1">
                        <FieldLabel label="D. Total" k="totalDiscs" />
                        <input
                          type="number"
                          value={
                            typeof edited.totalDiscs === 'number'
                              ? edited.totalDiscs
                              : (edited.totalDiscs ?? '')
                          }
                          onChange={(e) =>
                            setField('totalDiscs', parseNumberOrNull(e.target.value))
                          }
                          onFocus={() => {
                            if (isMulti && !applyFields.totalDiscs)
                              setApplyField('totalDiscs', true);
                          }}
                          disabled={isMulti && !applyFields.totalDiscs}
                          className="w-full bg-black/40 border border-white/5 rounded px-2 py-1 text-xs text-center focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Composer */}
                <div className="space-y-1">
                  <FieldLabel label="Composer" k="composer" />
                  <TextInput k="composer" placeholder="Composer" />
                </div>

                {/* Comment */}
                <div className="space-y-1">
                  <FieldLabel label="Comment" k="comment" />
                  <textarea
                    value={
                      typeof edited.comment === 'string' ? edited.comment : (edited.comment ?? '')
                    }
                    onChange={(e) => setField('comment', e.target.value)}
                    onFocus={() => {
                      if (isMulti && !applyFields.comment) setApplyField('comment', true);
                    }}
                    disabled={isMulti && !applyFields.comment}
                    rows={3}
                    className="w-full bg-white/5 border border-white/5 rounded-lg px-2.5 py-2 text-xs text-text-primary focus:bg-black focus:border-primary/50 outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* File ops */}
                <div className="pt-4 border-t border-white/10 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        if (selectedTracks.length === 1) onCopyMetadata(selectedTracks[0]);
                      }}
                      disabled={selectedTracks.length !== 1}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Clipboard className="w-3.5 h-3.5" /> Copy Tags
                    </button>
                    <button
                      onClick={() => onPasteMetadata(selectedTracks)}
                      disabled={selectedTracks.length === 0}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" /> Paste Tags
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => onRevealFiles(selectedTracks)}
                      disabled={selectedTracks.length === 0}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> Reveal File
                    </button>

                    <button
                      onClick={requestDeleteFiles}
                      disabled={selectedTracks.length === 0}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg bg-red-500/5 hover:bg-red-500/10 text-xs text-red-400 border border-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete File
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={async () => {
                        const folder = await selectFolder();
                        if (folder && selectedTracks.length > 0)
                          onMoveTracks(selectedTracks, folder);
                      }}
                      disabled={selectedTracks.length === 0}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Move className="w-3.5 h-3.5" /> Move
                    </button>

                    {onRemoveTracks ? (
                      <button
                        onClick={() => onRemoveTracks(selectedTracks)}
                        disabled={selectedTracks.length === 0}
                        className="flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ListPlus className="w-3.5 h-3.5" /> Add to Playlist
                  </button>
                </div>
              </div>

              {/* Footer actions */}
              <div className="p-4 bg-[#0a0a0a] border-t border-white/10 shrink-0 space-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    className="flex-1 py-3 rounded-lg bg-white text-black font-bold text-sm shadow hover:scale-[1.01] active:scale-[0.99] transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                  >
                    <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={handleRevert}
                    disabled={!hasChanges}
                    className="p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
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
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-secondary border border-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
