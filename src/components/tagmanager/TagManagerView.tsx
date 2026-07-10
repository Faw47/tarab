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
  ImageOff,
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
import { formatTime } from '../../lib/format-time';
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
import type { ContextMenuPosition, TagClearField, TagInfo, TagUpdate, Track } from '../../types';
import { PlaylistPickerDialog } from '../playlist/PlaylistPickerDialog';
import { CoverArtImage } from '../shared/CoverArtImage';
import { VirtualizedList } from '../shared/VirtualizedList';
import { ConfirmDialog, type ConfirmDialogProps } from '../ui/ConfirmDialog';
import { InputDialog, type InputDialogProps } from '../ui/InputDialog';
import {
  buildFolderTree,
  type FileFilter,
  filterAndSortTracks,
  formatQuality,
  getSelectedFolderName,
  type SortColumn,
  type SortDirection,
} from './tag-manager-model';
import { useTagManagerLibraryTracks } from './useTagManagerLibraryTracks';

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

type TagEditKey = Extract<
  keyof TagInfo,
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'year'
  | 'genre'
  | 'trackNumber'
  | 'totalTracks'
  | 'discNumber'
  | 'totalDiscs'
  | 'composer'
  | 'comment'
>;

type EditableTagValue = string | number | null | undefined;
type TagEditState = Partial<Record<TagEditKey, EditableTagValue>>;
type PendingTagUpdate = Partial<Record<TagEditKey, EditableTagValue>> &
  Pick<TagUpdate, 'coverArtBase64' | 'coverArtMime' | 'clearFields'>;

const TAG_FIELDS: Array<{
  key: TagEditKey;
  label: string;
  kind: 'text' | 'number' | 'textarea';
  placeholder?: string;
}> = [
  { key: 'title', label: 'Title', kind: 'text', placeholder: 'Title' },
  { key: 'artist', label: 'Artist', kind: 'text', placeholder: 'Artist' },
  { key: 'album', label: 'Album', kind: 'text', placeholder: 'Album' },
  { key: 'albumArtist', label: 'Album Artist', kind: 'text', placeholder: 'Album Artist' },
  { key: 'genre', label: 'Genre', kind: 'text', placeholder: 'Genre' },
  { key: 'year', label: 'Year', kind: 'number', placeholder: 'Year' },
  { key: 'trackNumber', label: 'Track #', kind: 'number', placeholder: '#' },
  { key: 'totalTracks', label: 'Total Tracks', kind: 'number', placeholder: 'Total' },
  { key: 'discNumber', label: 'Disc #', kind: 'number', placeholder: 'Disc' },
  { key: 'totalDiscs', label: 'Total Discs', kind: 'number', placeholder: 'Total' },
  { key: 'composer', label: 'Composer', kind: 'text', placeholder: 'Composer' },
  { key: 'comment', label: 'Comment', kind: 'textarea', placeholder: 'Comment' },
];
const getEditableTagValue = (tags: TagInfo, key: TagEditKey): EditableTagValue => tags[key];

const pickEditableTags = (tags: TagInfo): TagEditState => {
  const next: TagEditState = {};
  for (const field of TAG_FIELDS) {
    next[field.key] = getEditableTagValue(tags, field.key);
  }
  return next;
};

const hasTagEditKey = (state: TagEditState, key: TagEditKey): boolean => key in state;

const addClearField = (updates: TagUpdate | PendingTagUpdate, key: TagClearField) => {
  updates.clearFields = updates.clearFields?.includes(key)
    ? updates.clearFields
    : [...(updates.clearFields ?? []), key];
};

const setTagUpdateField = (
  updates: TagUpdate | PendingTagUpdate,
  key: TagEditKey,
  value: EditableTagValue,
) => {
  if (value === null || value === undefined) {
    updates[key] = null;
    addClearField(updates, key);
    return;
  }

  updates[key] = value;
};

const tagValuesEqual = (left: EditableTagValue, right: EditableTagValue): boolean => {
  if (left == null && right == null) return true;
  if (typeof left === 'number' || typeof right === 'number') return left === right;
  return String(left ?? '') === String(right ?? '');
};

const tagEditStateToUpdate = (state: TagEditState): TagUpdate => {
  const updates: TagUpdate = {};
  for (const field of TAG_FIELDS) {
    if (hasTagEditKey(state, field.key)) {
      setTagUpdateField(updates, field.key, state[field.key]);
    }
  }
  return updates;
};

// const CORE_KEYS: TagEditKey[] = ['title', 'artist', 'album'];
// const GRID_KEYS: TagEditKey[] = ['albumArtist', 'genre', 'year'];
// const NUM_KEYS: TagEditKey[] = ['trackNumber', 'totalTracks', 'discNumber', 'totalDiscs'];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });

  await Promise.all(runners);
  return results;
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

  // Selection + focus + range
  const selectedSet = useMemo(() => new Set(selectedTracks.map((t) => t.id)), [selectedTracks]);
  const selectionAnchorIndexRef = useRef<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Virtual list
  const ROW_H = 52;
  const scrollToIndexRef = useRef<
    ((index: number, align?: 'auto' | 'start' | 'center' | 'end') => void) | null
  >(null);

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

  // Map id to index
  const idToIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < filteredTracks.length; i++) m.set(filteredTracks[i].id, i);
    return m;
  }, [filteredTracks]);

  // Keep focus in bounds on filter changes
  useEffect(() => {
    setFocusedIndex((prev) => {
      if (filteredTracks.length === 0) return -1;
      if (prev < 0) return 0;
      return clamp(prev, 0, filteredTracks.length - 1);
    });
  }, [filteredTracks.length]);

  const scrollToIndexNearest = useCallback((index: number) => {
    scrollToIndexRef.current?.(index);
  }, []);

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

  const handleToggleAll = useCallback(() => {
    const allSelected = selectedSet.size > 0 && selectedSet.size === filteredTracks.length;
    onSelectionChange(allSelected ? [] : filteredTracks);
    selectionAnchorIndexRef.current = allSelected ? null : 0;
    setFocusedIndex(allSelected ? -1 : 0);
    if (!allSelected) scrollToIndexNearest(0);
  }, [filteredTracks, onSelectionChange, scrollToIndexNearest, selectedSet.size]);

  const allSelected = selectedSet.size > 0 && selectedSet.size === filteredTracks.length;

  const handleRowClick = useCallback(
    (track: Track, e: React.MouseEvent, index: number) => {
      const isCmd = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      setFocusedIndex(index);
      selectionAnchorIndexRef.current = selectionAnchorIndexRef.current ?? index;

      if (isShift) {
        const anchor = selectionAnchorIndexRef.current ?? index;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const range = filteredTracks.slice(start, end + 1);

        if (isCmd) {
          const union = new Map<string, Track>();
          selectedTracks.forEach((t) => union.set(t.id, t));
          range.forEach((t) => union.set(t.id, t));
          onSelectionChange(Array.from(union.values()));
        } else {
          onSelectionChange(range);
        }

        scrollToIndexNearest(index);
        return;
      }

      if (isCmd) {
        onToggleTrack(track, true);
        scrollToIndexNearest(index);
        return;
      }

      onSelectionChange([track]);
      selectionAnchorIndexRef.current = index;
      scrollToIndexNearest(index);
    },
    [filteredTracks, onSelectionChange, onToggleTrack, scrollToIndexNearest, selectedTracks],
  );

  // Keyboard behavior in table
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filteredTracks.length === 0) return;
      const isCmd = e.metaKey || e.ctrlKey;

      if (e.key === 'Escape') {
        setShowSourceDropdown(false);
        setShowPlaylistPicker(false);
        setConfirmModal(null);
        if (selectedTracks.length > 0) onSelectionChange([]);
        return;
      }

      if (isCmd && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        onSelectionChange(filteredTracks);
        selectionAnchorIndexRef.current = 0;
        setFocusedIndex(0);
        scrollToIndexNearest(0);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = clamp((prev < 0 ? 0 : prev) + 1, 0, filteredTracks.length - 1);
          scrollToIndexNearest(next);
          return next;
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = clamp((prev < 0 ? 0 : prev) - 1, 0, filteredTracks.length - 1);
          scrollToIndexNearest(next);
          return next;
        });
        return;
      }

      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        const idx = focusedIndex < 0 ? 0 : focusedIndex;
        const t = filteredTracks[idx];
        if (!t) return;
        onToggleTrack(t, true);
        selectionAnchorIndexRef.current = selectionAnchorIndexRef.current ?? idx;
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const idx = focusedIndex < 0 ? 0 : focusedIndex;
        const t = filteredTracks[idx];
        if (!t) return;
        onSelectionChange([t]);
        selectionAnchorIndexRef.current = idx;
        return;
      }
    },
    [
      filteredTracks,
      focusedIndex,
      onSelectionChange,
      onToggleTrack,
      scrollToIndexNearest,
      selectedTracks.length,
    ],
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

      // Write tags
      if (Object.keys(updates).length > 0) {
        if (selectedTracks.length === 1) {
          await writeTags(selectedTracks[0].filePath, updates);
        } else {
          await writeTagsBatch(
            selectedTracks.map((t) => t.filePath),
            updates,
          );
        }
      }

      if (snapshotItems.length > 0) {
        setUndo({
          expiresAt: Date.now() + 10_000,
          label:
            selectedTracks.length === 1
              ? 'Saved changes (undo available)'
              : `Saved changes to ${selectedTracks.length} tracks (undo available)`,
          items: snapshotItems,
        });
      }

      setCoverArtAction({ kind: 'none' });

      if (selectedTracks.length === 1) {
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

    try {
      await mapWithConcurrency(snapshot.items, 8, async (it) => {
        if (Object.keys(it.restore).length === 0) return;
        await writeTags(it.filePath, tagEditStateToUpdate(it.restore));
      });

      if (selectedTracks.length === 1) await loadSingleTrackTags(selectedTracks[0]);
    } catch (err) {
      reportError('Failed to undo', { source: 'tag-manager-view', error: err });
    }
  };

  const requestDeleteFiles = () => {
    if (selectedTracks.length === 0) return;

    const count = selectedTracks.length;
    const sample = selectedTracks
      .slice(0, 6)
      .map((t) => normalizePath(t.filePath).split('/').pop() || t.title || t.id);

    setConfirmModal({
      title: 'Delete Files',
      variant: 'danger',
      confirmLabel: count === 1 ? 'Delete File' : `Delete ${count} Files`,
      message: `This will permanently delete ${count} file${count === 1 ? '' : 's'}.`,
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
        <label className="text-[10px] uppercase text-text-subtle font-bold">{label}</label>
        {isMulti && (
          <button
            type="button"
            onClick={() => setApplyField(k, !applied)}
            className={clsx(
              'px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors',
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
            onClick={(e) => {
              e.stopPropagation();
              setShowSourceDropdown((v) => !v);
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors border border-white/5 min-w-[180px]"
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
            <div className="absolute top-full left-0 mt-2 w-72 bg-[#1a1a1a] border border-white/10 rounded-xl py-1 shadow-2xl overflow-y-auto max-h-[420px] z-50 custom-scrollbar">
              <button
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
            className="w-full bg-black/20 rounded-lg pl-9 pr-4 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 focus:bg-black/40 transition-all border border-white/5"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1 border border-white/5">
          {(['all', 'missing-art', 'untagged'] as FileFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setFileFilter(filter)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all',
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
          <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted">
            <span>Loading full library for bulk editing</span>
            <span>
              {hydrationLoadedCount} / {hydrationTotalCount}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
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
          <div className="shrink-0 grid grid-cols-[40px_48px_1.5fr_1fr_1fr_60px_70px] gap-2 px-4 py-2 border-b border-white/5 text-[10px] font-bold uppercase tracking-widest text-text-subtle bg-white/[0.02]">
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
                title:
                  'Keyboard: Up/Down to move, Space toggle, Enter select, Cmd/Ctrl+A select all',
              }}
              onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop > 8)}
              renderItem={(track, index) => {
                const isSelected = selectedSet.has(track.id);
                const isFocused = index === focusedIndex;
                const { format, isLossless } = formatQuality(track);

                return (
                  <div
                    onClick={(e) => handleRowClick(track, e, index)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!selectedSet.has(track.id)) onSelectionChange([track]);
                      onTrackContextMenu?.(track, { x: e.clientX, y: e.clientY });
                    }}
                    className={clsx(
                      'grid grid-cols-[40px_48px_1.5fr_1fr_1fr_60px_70px] gap-2 px-4 border-b border-white/[0.02] cursor-pointer items-center group transition-colors text-sm',
                      isSelected ? 'bg-primary/10' : 'hover:bg-white/5',
                      isFocused && 'ring-1 ring-primary/40',
                    )}
                    style={{ height: ROW_H }}
                  >
                    <span className="text-xs text-text-subtle text-center font-mono">
                      {index + 1}
                    </span>

                    <div className="w-9 h-9 rounded bg-white/5 overflow-hidden border border-white/5">
                      <CoverArtImage
                        track={track}
                        className="w-full h-full"
                        imgClassName="w-full h-full object-cover"
                        roundedClassName=""
                        iconClassName="w-4 h-4"
                        alt={track.album}
                      />
                    </div>

                    <div className="min-w-0 pr-4">
                      <div
                        className={clsx(
                          'font-medium truncate',
                          isSelected ? 'text-primary' : 'text-text-primary',
                        )}
                      >
                        {track.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {isLossless && (
                          <span className="text-[9px] text-primary font-bold uppercase">
                            {format}
                          </span>
                        )}
                        {!track.hasCoverArt && (
                          <span className="text-[9px] text-amber-400 font-bold uppercase flex items-center gap-1">
                            <ImageOff className="w-3 h-3" /> no cover
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-text-secondary truncate pr-4">{track.artist}</div>
                    <div className="text-text-muted truncate pr-4">{track.album}</div>
                    <div className="text-text-muted text-right">{track.year || '-'}</div>
                    <div className="text-text-muted text-right font-mono text-xs">
                      {formatTime(track.duration)}
                    </div>
                  </div>
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
                  <span className="text-[10px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
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
                      className="text-[10px] text-center text-text-secondary hover:text-white transition-colors"
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
                    className="flex-1 py-3 rounded-lg bg-white text-black font-bold text-sm shadow hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
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
