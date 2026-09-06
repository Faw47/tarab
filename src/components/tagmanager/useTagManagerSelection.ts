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
  allowSelectAll?: boolean;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function useTagManagerSelection({
  filteredTracks,
  selectedTracks,
  onSelectionChange,
  onToggleTrack,
  onEscape,
  allowSelectAll = true,
}: UseTagManagerSelectionOptions) {
  const selectedSet = useMemo(
    () => new Set(selectedTracks.map((track) => track.id)),
    [selectedTracks],
  );
  const selectionAnchorIdRef = useRef<string | null>(null);
  const selectionAnchorIndexRef = useRef<number | null>(null);
  const focusedTrackIdRef = useRef<string | null>(null);
  const previousFilteredTracksRef = useRef(filteredTracks);
  const [focusedIndex, setFocusedIndexState] = useState(-1);
  const scrollToIndexRef = useRef<((index: number, align?: ScrollAlignment) => void) | null>(null);

  const idToIndex = useMemo(() => {
    const indexes = new Map<string, number>();
    for (let index = 0; index < filteredTracks.length; index += 1) {
      indexes.set(filteredTracks[index].id, index);
    }
    return indexes;
  }, [filteredTracks]);

  const setFocusedIndex = useCallback(
    (index: number) => {
      focusedTrackIdRef.current = filteredTracks[index]?.id ?? null;
      setFocusedIndexState(index);
    },
    [filteredTracks],
  );

  const setSelectionAnchor = useCallback(
    (index: number | null) => {
      selectionAnchorIndexRef.current = index;
      selectionAnchorIdRef.current = index == null ? null : (filteredTracks[index]?.id ?? null);
    },
    [filteredTracks],
  );

  useEffect(() => {
    setFocusedIndexState((previous) => {
      if (filteredTracks.length === 0) {
        focusedTrackIdRef.current = null;
        return -1;
      }

      if (focusedTrackIdRef.current) {
        const trackedIndex = idToIndex.get(focusedTrackIdRef.current);
        if (trackedIndex !== undefined) return trackedIndex;
        focusedTrackIdRef.current = null;
      }

      const next = previous < 0 ? 0 : clamp(previous, 0, filteredTracks.length - 1);
      focusedTrackIdRef.current = filteredTracks[next]?.id ?? null;
      return next;
    });

    const previousFilteredTracks = previousFilteredTracksRef.current;
    if (selectionAnchorIdRef.current) {
      selectionAnchorIndexRef.current = idToIndex.get(selectionAnchorIdRef.current) ?? null;
    } else if (selectionAnchorIndexRef.current !== null) {
      const anchorTrack =
        previousFilteredTracks[selectionAnchorIndexRef.current] ??
        filteredTracks[selectionAnchorIndexRef.current];
      const anchorId = anchorTrack?.id ?? null;
      selectionAnchorIdRef.current = anchorId;
      selectionAnchorIndexRef.current = anchorId ? (idToIndex.get(anchorId) ?? null) : null;
    }
    previousFilteredTracksRef.current = filteredTracks;
  }, [filteredTracks, idToIndex]);

  const scrollToIndexNearest = useCallback((index: number) => {
    scrollToIndexRef.current?.(index);
  }, []);

  const allSelected =
    filteredTracks.length > 0 && filteredTracks.every((track) => selectedSet.has(track.id));

  const selectAllVisible = useCallback(() => {
    if (!allowSelectAll || filteredTracks.length === 0) return;

    const selectionById = new Map<string, Track>();
    for (const selected of selectedTracks) selectionById.set(selected.id, selected);
    for (const track of filteredTracks) selectionById.set(track.id, track);
    onSelectionChange(Array.from(selectionById.values()));
    setSelectionAnchor(0);
    setFocusedIndex(0);
    scrollToIndexNearest(0);
  }, [
    allowSelectAll,
    filteredTracks,
    onSelectionChange,
    scrollToIndexNearest,
    selectedTracks,
    setFocusedIndex,
    setSelectionAnchor,
  ]);

  const handleToggleAll = useCallback(() => {
    if (!allowSelectAll || filteredTracks.length === 0) return;
    if (!allSelected) {
      selectAllVisible();
      return;
    }

    const visibleIds = new Set(filteredTracks.map((track) => track.id));
    onSelectionChange(selectedTracks.filter((track) => !visibleIds.has(track.id)));
    setSelectionAnchor(null);
    setFocusedIndex(-1);
  }, [
    allSelected,
    allowSelectAll,
    filteredTracks,
    onSelectionChange,
    selectAllVisible,
    selectedTracks,
    setFocusedIndex,
    setSelectionAnchor,
  ]);

  const handleRowClick = useCallback(
    (track: Track, event: MouseEvent, index: number) => {
      const isCommand = event.metaKey || event.ctrlKey;
      const isRange = event.shiftKey;

      setFocusedIndex(index);
      if (selectionAnchorIndexRef.current === null) setSelectionAnchor(index);

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
      setSelectionAnchor(index);
      scrollToIndexNearest(index);
    },
    [
      filteredTracks,
      onSelectionChange,
      onToggleTrack,
      scrollToIndexNearest,
      selectedTracks,
      setFocusedIndex,
      setSelectionAnchor,
    ],
  );

  const handleTableKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onEscape();
        if (selectedTracks.length > 0) onSelectionChange([]);
        return;
      }
      if (filteredTracks.length === 0) return;
      const isCommand = event.metaKey || event.ctrlKey;

      if (isCommand && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        if (allowSelectAll) selectAllVisible();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setFocusedIndexState((previous) => {
          const next = clamp(
            (previous < 0 ? 0 : previous) + direction,
            0,
            filteredTracks.length - 1,
          );
          focusedTrackIdRef.current = filteredTracks[next]?.id ?? null;
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
        if (selectionAnchorIndexRef.current === null) setSelectionAnchor(index);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const index = focusedIndex < 0 ? 0 : focusedIndex;
        const track = filteredTracks[index];
        if (!track) return;
        onSelectionChange([track]);
        setSelectionAnchor(index);
      }
    },
    [
      allowSelectAll,
      filteredTracks,
      focusedIndex,
      onEscape,
      onSelectionChange,
      onToggleTrack,
      selectAllVisible,
      scrollToIndexNearest,
      selectedTracks.length,
      setSelectionAnchor,
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
    setSelectionAnchor,
    selectionAnchorIndexRef,
    setFocusedIndex,
  };
}
