import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Track } from '../../types';

type ScrollAlignment = 'auto' | 'start' | 'center' | 'end';

interface UseTagManagerSelectionOptions {
  filteredTracks: Track[];
  selectedTracks: Track[];
  onSelectionChange: (tracks: Track[]) => void;
  onToggleTrack: (track: Track, isMulti: boolean) => void;
  onEscape: () => void;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function useTagManagerSelection({
  filteredTracks,
  selectedTracks,
  onSelectionChange,
  onToggleTrack,
  onEscape,
}: UseTagManagerSelectionOptions) {
  const selectedSet = useMemo(
    () => new Set(selectedTracks.map((track) => track.id)),
    [selectedTracks],
  );
  const selectionAnchorIndexRef = useRef<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const scrollToIndexRef = useRef<((index: number, align?: ScrollAlignment) => void) | null>(null);

  const idToIndex = useMemo(() => {
    const indexes = new Map<string, number>();
    for (let index = 0; index < filteredTracks.length; index += 1) {
      indexes.set(filteredTracks[index].id, index);
    }
    return indexes;
  }, [filteredTracks]);

  useEffect(() => {
    setFocusedIndex((previous) => {
      if (filteredTracks.length === 0) return -1;
      if (previous < 0) return 0;
      return clamp(previous, 0, filteredTracks.length - 1);
    });
  }, [filteredTracks.length]);

  const scrollToIndexNearest = useCallback((index: number) => {
    scrollToIndexRef.current?.(index);
  }, []);

  const allSelected = selectedSet.size > 0 && selectedSet.size === filteredTracks.length;

  const handleToggleAll = useCallback(() => {
    onSelectionChange(allSelected ? [] : filteredTracks);
    selectionAnchorIndexRef.current = allSelected ? null : 0;
    setFocusedIndex(allSelected ? -1 : 0);
    if (!allSelected) scrollToIndexNearest(0);
  }, [allSelected, filteredTracks, onSelectionChange, scrollToIndexNearest]);

  const handleRowClick = useCallback(
    (track: Track, event: MouseEvent, index: number) => {
      const isCommand = event.metaKey || event.ctrlKey;
      const isRange = event.shiftKey;

      setFocusedIndex(index);
      selectionAnchorIndexRef.current = selectionAnchorIndexRef.current ?? index;

      if (isRange) {
        const anchor = selectionAnchorIndexRef.current ?? index;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const range = filteredTracks.slice(start, end + 1);

        if (isCommand) {
          const union = new Map<string, Track>();
          for (const selected of selectedTracks) union.set(selected.id, selected);
          for (const ranged of range) union.set(ranged.id, ranged);
          onSelectionChange(Array.from(union.values()));
        } else {
          onSelectionChange(range);
        }
        scrollToIndexNearest(index);
        return;
      }

      if (isCommand) {
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

  const handleTableKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (filteredTracks.length === 0) return;
      const isCommand = event.metaKey || event.ctrlKey;

      if (event.key === 'Escape') {
        onEscape();
        if (selectedTracks.length > 0) onSelectionChange([]);
        return;
      }

      if (isCommand && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        onSelectionChange(filteredTracks);
        selectionAnchorIndexRef.current = 0;
        setFocusedIndex(0);
        scrollToIndexNearest(0);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setFocusedIndex((previous) => {
          const next = clamp(
            (previous < 0 ? 0 : previous) + direction,
            0,
            filteredTracks.length - 1,
          );
          scrollToIndexNearest(next);
          return next;
        });
        return;
      }

      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        const index = focusedIndex < 0 ? 0 : focusedIndex;
        const track = filteredTracks[index];
        if (!track) return;
        onToggleTrack(track, true);
        selectionAnchorIndexRef.current = selectionAnchorIndexRef.current ?? index;
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const index = focusedIndex < 0 ? 0 : focusedIndex;
        const track = filteredTracks[index];
        if (!track) return;
        onSelectionChange([track]);
        selectionAnchorIndexRef.current = index;
      }
    },
    [
      filteredTracks,
      focusedIndex,
      onEscape,
      onSelectionChange,
      onToggleTrack,
      scrollToIndexNearest,
      selectedTracks.length,
    ],
  );

  return {
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
  };
}
