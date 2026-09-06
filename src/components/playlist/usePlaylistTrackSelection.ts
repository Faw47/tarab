import {
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { PlaylistEntry } from '../../types';

interface UsePlaylistTrackSelectionOptions {
  entries: PlaylistEntry[];
  allEntries?: PlaylistEntry[];
  resetKey: string | null;
  selectedTrackIds: ReadonlySet<string>;
  onSelectionChange: Dispatch<SetStateAction<Set<string>>>;
  allowSelection?: boolean;
  onPlayEntry?: (entry: PlaylistEntry) => void;
  onRemoveSelected?: (trackIds: string[]) => void;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement && target.type === 'checkbox') return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.closest('button, select') !== null
  );
};

export function usePlaylistTrackSelection({
  entries,
  allEntries,
  resetKey,
  selectedTrackIds,
  onSelectionChange,
  allowSelection = true,
  onPlayEntry,
  onRemoveSelected,
}: UsePlaylistTrackSelectionOptions) {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const focusedTrackIdRef = useRef<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const selectionEntries = allEntries ?? entries;

  useEffect(() => {
    onSelectionChange(new Set());
    selectionAnchorIdRef.current = null;
    const firstEntry = entriesRef.current[0];
    focusedTrackIdRef.current = firstEntry?.trackId ?? null;
    setFocusedIndex(firstEntry ? 0 : -1);
  }, [onSelectionChange, resetKey]);

  useEffect(() => {
    if (entries.length === 0) {
      setFocusedIndex(-1);
      selectionAnchorIdRef.current = null;
      focusedTrackIdRef.current = null;
      return;
    }

    const focusedEntryIndex = focusedTrackIdRef.current
      ? entries.findIndex((entry) => entry.trackId === focusedTrackIdRef.current)
      : -1;
    setFocusedIndex((previous) => {
      const nextIndex =
        focusedEntryIndex >= 0
          ? focusedEntryIndex
          : clamp(previous < 0 ? 0 : previous, 0, entries.length - 1);
      focusedTrackIdRef.current = entries[nextIndex]?.trackId ?? null;
      return nextIndex;
    });

    if (
      selectionAnchorIdRef.current &&
      !selectionEntries.some((entry) => entry.trackId === selectionAnchorIdRef.current)
    ) {
      selectionAnchorIdRef.current = null;
    }

    if (!allowSelection) {
      selectionAnchorIdRef.current = null;
      onSelectionChange((current) => (current.size === 0 ? current : new Set()));
      return;
    }

    const availableIds = new Set(selectionEntries.map((entry) => entry.trackId));
    onSelectionChange((current) => {
      const next = new Set(current);
      let changed = false;
      for (const trackId of current) {
        if (!availableIds.has(trackId)) {
          next.delete(trackId);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [allowSelection, entries, onSelectionChange, selectionEntries]);

  const focusEntry = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      focusedTrackIdRef.current = entry.trackId;
      setFocusedIndex(index);
    },
    [entries],
  );

  const addRangeToSelection = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!allowSelection) return;
      const start = Math.min(startIndex, endIndex);
      const end = Math.max(startIndex, endIndex);
      onSelectionChange((current) => {
        const next = new Set(current);
        for (const entry of entries.slice(start, end + 1)) next.add(entry.trackId);
        return next;
      });
    },
    [allowSelection, entries, onSelectionChange],
  );

  const handleEntryToggle = useCallback(
    (index: number, event: MouseEvent<HTMLInputElement>) => {
      if (!allowSelection) return;
      event.preventDefault();

      const entry = entries[index];
      if (!entry) return;

      const anchorIndex = selectionAnchorIdRef.current
        ? entries.findIndex((candidate) => candidate.trackId === selectionAnchorIdRef.current)
        : -1;
      if (event.shiftKey && anchorIndex >= 0) {
        addRangeToSelection(anchorIndex, index);
      } else {
        onSelectionChange((current) => {
          const next = new Set(current);
          if (next.has(entry.trackId)) next.delete(entry.trackId);
          else next.add(entry.trackId);
          return next;
        });
        selectionAnchorIdRef.current = entry.trackId;
      }
      focusEntry(index);
    },
    [addRangeToSelection, allowSelection, entries, focusEntry, onSelectionChange],
  );

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === 'checkbox' &&
        (event.key === ' ' || event.key === 'Spacebar')
      ) {
        return;
      }
      if (isTextEntryTarget(event.target)) return;

      const isCommand = event.metaKey || event.ctrlKey;
      if (isCommand && (event.key === 'a' || event.key === 'A')) {
        if (!allowSelection || entries.length === 0) return;
        event.preventDefault();
        onSelectionChange((current) => {
          const next = new Set(current);
          for (const entry of entries) next.add(entry.trackId);
          return next;
        });
        selectionAnchorIdRef.current = entries[0]?.trackId ?? null;
        focusEntry(0);
        return;
      }

      if (entries.length === 0) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const currentIndex = focusedTrackIdRef.current
          ? entries.findIndex((entry) => entry.trackId === focusedTrackIdRef.current)
          : -1;
        const baseline = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : entries.length;
        const nextIndex = clamp(baseline + direction, 0, entries.length - 1);

        if (event.shiftKey && allowSelection) {
          const anchorIndex = selectionAnchorIdRef.current
            ? entries.findIndex((entry) => entry.trackId === selectionAnchorIdRef.current)
            : -1;
          const resolvedAnchorIndex = anchorIndex >= 0 ? anchorIndex : nextIndex;
          selectionAnchorIdRef.current = entries[resolvedAnchorIndex]?.trackId ?? null;
          addRangeToSelection(resolvedAnchorIndex, nextIndex);
          focusEntry(nextIndex);
        } else {
          focusEntry(nextIndex);
          selectionAnchorIdRef.current = entries[nextIndex]?.trackId ?? null;
        }
        return;
      }

      if (event.key === 'Enter') {
        const currentIndex = focusedTrackIdRef.current
          ? entries.findIndex((entry) => entry.trackId === focusedTrackIdRef.current)
          : focusedIndex;
        const entry = entries[currentIndex];
        if (!entry) return;
        event.preventDefault();
        onPlayEntry?.(entry);
        return;
      }

      if (
        event.key === 'Delete' &&
        allowSelection &&
        selectedTrackIds.size > 0 &&
        onRemoveSelected
      ) {
        event.preventDefault();
        onRemoveSelected([...selectedTrackIds]);
      }
    },
    [
      addRangeToSelection,
      allowSelection,
      entries,
      focusEntry,
      focusedIndex,
      onPlayEntry,
      onRemoveSelected,
      onSelectionChange,
      selectedTrackIds,
    ],
  );

  const clearSelection = useCallback(() => {
    onSelectionChange(new Set());
    selectionAnchorIdRef.current = null;
  }, [onSelectionChange]);

  return {
    clearSelection,
    focusedIndex,
    handleEntryToggle,
    handleListKeyDown,
    selectedTrackIds,
  };
}
