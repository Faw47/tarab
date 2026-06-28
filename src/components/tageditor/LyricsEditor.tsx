import { clsx } from 'clsx';
import {
  AlertCircle,
  Check,
  Edit2,
  Loader2,
  Pause,
  Play,
  Plus,
  Repeat1,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatTime } from '../../lib/format-time';
import { rangeProgressStyle } from '../../lib/range-progress-style';
import { pausePlayback, playTrack, resumePlayback, seekPlayback } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';

interface LyricLine {
  id: string;
  time: number;
  text: string;
}

interface LyricsEditorProps {
  trackPath: string;
  lyricsContent: string;
  onChange: (content: string) => void;
  onSave: () => void;
  isSaving: boolean;
}

// ── History reducer ────────────────────────────────────────────────────────
// Replaces the two separate useState<LyricLine[][]>/useState<number> pair
// that had a stale-closure bug: setHistory's updater received fresh `prev`
// but sliced it at a potentially stale `historyIndex` captured from a
// different render. Managing both pieces of state atomically in a reducer
// eliminates the race.
//
// `lines` is derived directly from `hist.snapshots[hist.index]` so the two
// are always in sync without a second useState.

interface HistoryState {
  snapshots: LyricLine[][];
  index: number;
}

type HistoryAction = { type: 'push'; lines: LyricLine[] } | { type: 'undo' } | { type: 'redo' };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'push': {
      // Discard any future states branched past (standard undo/redo behavior)
      const trimmed = state.snapshots.slice(0, state.index + 1);
      return { snapshots: [...trimmed, action.lines], index: state.index + 1 };
    }
    case 'undo':
      return state.index > 0 ? { ...state, index: state.index - 1 } : state;
    case 'redo':
      return state.index < state.snapshots.length - 1
        ? { ...state, index: state.index + 1 }
        : state;
    default:
      return state;
  }
}

// ── ID generation ──────────────────────────────────────────────────────────
// Previously used Date.now() + Math.random(), which produced a different ID
// on every parseLRC call even for unchanged lines. This broke React key
// reconciliation (all rows unmount/remount on re-parse) and invalidated
// selectedLineId/editingId silently. Deterministic IDs derived from time +
// index are stable across re-parses of the same content.
const makeLineId = (time: number, index: number): string => `${time.toFixed(2)}-${index}`;

// ── LRC parser ─────────────────────────────────────────────────────────────
// Fixed from original:
//   1. Accepts both 2-digit (centiseconds) and 3-digit (milliseconds) subseconds
//      — many lyric apps and download sites export 3-digit format; the original
//        regex hard-coded \d{2} and silently returned zero results on those files.
//   2. Deterministic IDs (see above).
const parseLRC = (content: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  // \d{2,3} covers both [00:12.34] (CS) and [00:12.345] (MS)
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    const raw = parseInt(match[3]);
    // Normalise to fractional seconds regardless of digit count
    const frac = match[3].length === 3 ? raw / 1000 : raw / 100;
    const time = minutes * 60 + seconds + frac;
    lines.push({
      id: '', // filled in after sort
      time,
      text: match[4] ?? '',
    });
  }

  lines.sort((a, b) => a.time - b.time);
  // Assign stable IDs after sort so index is deterministic
  lines.forEach((l, i) => {
    l.id = makeLineId(l.time, i);
  });
  return lines;
};

// ── LRC serialiser ─────────────────────────────────────────────────────────
// Fixed floating-point centisecond calculation. Original used:
//   Math.floor((seconds % 1) * 100)
// which gives 28 instead of 29 for seconds=1.29 due to IEEE 754 imprecision
// (1.29 % 1 === 0.28999…). Working entirely in integers avoids this.
const formatLRCTime = (seconds: number): string => {
  const totalCs = Math.round(seconds * 100);
  const mins = Math.floor(totalCs / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}]`;
};

const linesToLRC = (lines: LyricLine[]): string =>
  lines
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((line) => `${formatLRCTime(line.time)} ${line.text}`)
    .join('\n');

const REPEAT_DURATION = 5; // seconds

export const LyricsEditor = memo(
  ({ trackPath, lyricsContent, onChange, onSave, isSaving }: LyricsEditorProps) => {
    const {
      currentTrack,
      isPlaying,
      currentTime,
      duration,
      setIsPlaying,
      setCurrentTime,
      hasActivePlayback,
      setHasActivePlayback,
    } = usePlayerStore(
      useShallow((s) => ({
        currentTrack: s.currentTrack,
        isPlaying: s.isPlaying,
        currentTime: s.currentTime,
        duration: s.duration,
        setIsPlaying: s.setIsPlaying,
        setCurrentTime: s.setCurrentTime,
        hasActivePlayback: s.hasActivePlayback,
        setHasActivePlayback: s.setHasActivePlayback,
      })),
    );

    const [view, setView] = useState<'sync' | 'text'>('sync');

    // ── History (replaces separate lines/history/historyIndex state) ──────
    // Initialised with the parsed starting state at index 0 so the very first
    // edit is immediately undo-able. Previously index started at -1 and the
    // first edit set it to 0, making canUndo = (0 > 0) = false permanently
    // for that edit.
    const initialLines = useMemo(() => parseLRC(lyricsContent), []); // eslint-disable-line react-hooks/exhaustive-deps
    const [hist, dispatch] = useReducer(historyReducer, {
      snapshots: [initialLines],
      index: 0,
    });
    const lines = hist.snapshots[hist.index];
    const canUndo = hist.index > 0;
    const canRedo = hist.index < hist.snapshots.length - 1;

    const updateLines = useCallback((newLines: LyricLine[]) => {
      dispatch({ type: 'push', lines: newLines });
    }, []);

    const handleUndo = useCallback(() => dispatch({ type: 'undo' }), []);
    const handleRedo = useCallback(() => dispatch({ type: 'redo' }), []);

    const [textContent, setTextContent] = useState(lyricsContent);
    const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
    const [isRepeating, setIsRepeating] = useState(false);
    const [repeatRange, setRepeatRange] = useState<{ start: number; end: number } | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');
    const [userScrolled, setUserScrolled] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const listRef = useRef<HTMLDivElement>(null);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Replaced time-based debounce for repeat seek with a boolean flag.
    // The original 200ms wall-clock check could still fire a second seek if
    // the first seekPlayback() call took >200ms to resolve on slow I/O.
    const isSeekingRef = useRef(false);
    // parseDebounceTimer moved from useState to useRef. Storing a timer ID in
    // React state caused two re-renders per keystroke in the text editor:
    // one for the text update and one for the timer ID update.
    const parseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Ref map for stable scroll targets keyed by line ID.
    // Replaces `listRef.current.children[index]` which breaks if any
    // non-line element is ever inserted before the list rows.
    const lineRefsMap = useRef<Map<string, HTMLElement>>(new Map());
    // Ref-forwarded toggle so the keyboard shortcut effect always calls the
    // latest version without needing handleTogglePlay in its dep array.
    // Previously handleTogglePlay was missing from the keyboard effect deps,
    // causing space to use a stale closure that captured initial isPlaying state.
    const togglePlayRef = useRef<(() => Promise<void>) | null>(null);

    const isCurrentTrack = currentTrack?.filePath === trackPath;

    const currentLineIndex = useMemo(() => {
      if (!isCurrentTrack) return -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (currentTime >= lines[i].time) return i;
      }
      return -1;
    }, [lines, currentTime, isCurrentTrack]);

    const showError = useCallback((message: string) => {
      setErrorMessage(message);
      setTimeout(() => setErrorMessage(''), 3000);
    }, []);

    // Repeat mode — seek guard uses a boolean ref instead of a timestamp check
    useEffect(() => {
      if (!isRepeating || !repeatRange || !isCurrentTrack || !isPlaying) return;
      if (currentTime < repeatRange.end) return;
      if (isSeekingRef.current) return;

      isSeekingRef.current = true;
      seekPlayback(repeatRange.start)
        .then(() => setCurrentTime(repeatRange.start))
        .catch((e) => {
          console.error('Repeat seek failed:', e);
          showError('Failed to repeat');
        })
        .finally(() => {
          isSeekingRef.current = false;
        });
    }, [
      currentTime,
      isRepeating,
      repeatRange,
      isCurrentTrack,
      isPlaying,
      setCurrentTime,
      showError,
    ]);

    // Sync lines → parent only from sync view to avoid circular updates
    useEffect(() => {
      if (view !== 'sync') return;
      const newContent = linesToLRC(lines);
      if (newContent !== lyricsContent) onChange(newContent);
    }, [lines, view, lyricsContent, onChange]);

    // Auto-scroll: use lineRefsMap instead of children[index] indexing
    useEffect(() => {
      if (currentLineIndex < 0 || !isPlaying || userScrolled) return;
      const currentLine = lines[currentLineIndex];
      if (!currentLine) return;
      const el = lineRefsMap.current.get(currentLine.id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [currentLineIndex, isPlaying, userScrolled, lines]);

    // Reset user-scrolled flag after idle period
    useEffect(() => {
      if (!userScrolled) return;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => setUserScrolled(false), 3000);
      return () => {
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      };
    }, [userScrolled]);

    // Cleanup debounce timer on unmount
    useEffect(
      () => () => {
        if (parseDebounceRef.current) clearTimeout(parseDebounceRef.current);
      },
      [],
    );

    const handleScroll = useCallback(() => setUserScrolled(true), []);

    const handleTogglePlay = useCallback(async () => {
      try {
        if (!isCurrentTrack) {
          await playTrack(trackPath);
          setHasActivePlayback(true);
          setIsPlaying(true);
        } else if (isPlaying) {
          await pausePlayback();
          setIsPlaying(false);
        } else {
          if (!hasActivePlayback) {
            await playTrack(trackPath);
            setHasActivePlayback(true);
          } else {
            await resumePlayback();
          }
          setIsPlaying(true);
        }
      } catch (e) {
        console.error('Failed to toggle playback:', e);
        showError('Failed to control playback');
      }
    }, [
      trackPath,
      isCurrentTrack,
      isPlaying,
      hasActivePlayback,
      setIsPlaying,
      setHasActivePlayback,
      showError,
    ]);

    // Keep ref current so the keyboard handler always calls the latest version
    useEffect(() => {
      togglePlayRef.current = handleTogglePlay;
    }, [handleTogglePlay]);

    // Keyboard shortcuts — space uses ref to avoid stale closure on handleTogglePlay
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        if (e.key === ' ' && !e.repeat) {
          e.preventDefault();
          void togglePlayRef.current?.();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          onSave();
        } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
          e.preventDefault();
          handleUndo();
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
          e.preventDefault();
          handleRedo();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onSave, handleUndo, handleRedo]);

    const handleSeek = useCallback(
      async (time: number) => {
        if (!isCurrentTrack) {
          showError('Load this track first');
          return;
        }
        try {
          await seekPlayback(time);
          setCurrentTime(time);
        } catch (e) {
          console.error('Failed to seek:', e);
          showError('Failed to seek');
        }
      },
      [isCurrentTrack, setCurrentTime, showError],
    );

    const handleLineClick = useCallback(
      (line: LyricLine) => {
        setSelectedLineId(line.id);
        if (isCurrentTrack) void handleSeek(line.time);
      },
      [isCurrentTrack, handleSeek],
    );

    const handleRepeatLine = useCallback(
      (line: LyricLine, index: number) => {
        const nextLine = lines[index + 1];
        const end = nextLine
          ? Math.min(nextLine.time, line.time + REPEAT_DURATION)
          : line.time + REPEAT_DURATION;
        setRepeatRange({ start: line.time, end });
        setIsRepeating(true);
        if (isCurrentTrack) void handleSeek(line.time);
      },
      [lines, isCurrentTrack, handleSeek],
    );

    const handleStopRepeat = useCallback(() => {
      setIsRepeating(false);
      setRepeatRange(null);
    }, []);

    const handleAddLine = useCallback(() => {
      const time =
        isCurrentTrack && currentTime > 0
          ? currentTime
          : lines.length > 0
            ? lines[lines.length - 1].time + 1
            : 0;
      const newLine: LyricLine = {
        id: makeLineId(time, lines.length),
        time,
        text: '',
      };
      updateLines([...lines, newLine].sort((a, b) => a.time - b.time));
      setEditingId(newLine.id);
      setEditingText('');
    }, [isCurrentTrack, currentTime, lines, updateLines]);

    const handleDeleteLine = useCallback(
      (line: LyricLine) => {
        updateLines(lines.filter((l) => l.id !== line.id));
        if (selectedLineId === line.id) setSelectedLineId(null);
      },
      [lines, selectedLineId, updateLines],
    );

    const handleStartEdit = useCallback((line: LyricLine) => {
      setEditingId(line.id);
      setEditingText(line.text);
    }, []);

    const handleSaveEdit = useCallback(() => {
      if (!editingId) return;
      updateLines(
        lines.map((line) => (line.id === editingId ? { ...line, text: editingText } : line)),
      );
      setEditingId(null);
      setEditingText('');
    }, [editingId, editingText, lines, updateLines]);

    const handleCancelEdit = useCallback(() => {
      setEditingId(null);
      setEditingText('');
    }, []);

    const handleSetTimestamp = useCallback(
      (line: LyricLine) => {
        if (!isCurrentTrack) {
          showError('Load this track first to set timestamps');
          return;
        }
        updateLines(
          lines
            .map((l) => (l.id === line.id ? { ...l, time: currentTime } : l))
            .sort((a, b) => a.time - b.time),
        );
      },
      [isCurrentTrack, currentTime, lines, updateLines, showError],
    );

    // Text view: debounced parsing. Timer stored in ref (not state) to avoid
    // a re-render per keystroke.
    const handleTextChange = useCallback(
      (value: string) => {
        setTextContent(value);
        if (parseDebounceRef.current) clearTimeout(parseDebounceRef.current);
        parseDebounceRef.current = setTimeout(() => {
          parseDebounceRef.current = null;
          try {
            const parsed = parseLRC(value);
            if (parsed.length > 0 || value.trim() === '') {
              dispatch({ type: 'push', lines: parsed });
              onChange(value);
            } else {
              showError('Invalid LRC format');
            }
          } catch {
            showError('Failed to parse LRC');
          }
        }, 500);
      },
      [onChange, showError],
    );

    // Keep text editor content fresh when switching to text view
    useEffect(() => {
      if (view === 'text') setTextContent(linesToLRC(lines));
    }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

    // Switching text → sync view: block the transition on invalid content
    // rather than silently discarding edits. Previously the view switched
    // regardless and the user's changes were lost with only a 3s toast.
    const handleViewChange = useCallback(
      (newView: 'sync' | 'text') => {
        if (view === 'text' && newView === 'sync') {
          try {
            const parsed = parseLRC(textContent);
            if (parsed.length > 0 || textContent.trim() === '') {
              dispatch({ type: 'push', lines: parsed });
              onChange(textContent);
            } else {
              showError('Fix the LRC format before switching views');
              return; // block the switch
            }
          } catch {
            showError('Fix the LRC format before switching views');
            return; // block the switch
          }
        }
        setView(newView);
      },
      [view, textContent, onChange, showError],
    );

    return (
      <div className="space-y-4">
        {/* Error message */}
        {errorMessage && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Playback controls */}
        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="flex items-center gap-4 mb-3">
            <button
              onClick={() => void handleTogglePlay()}
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition"
              aria-label={isPlaying && isCurrentTrack ? 'Pause' : 'Play'}
            >
              {isPlaying && isCurrentTrack ? (
                <Pause className="w-5 h-5" fill="currentColor" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
              )}
            </button>

            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.01}
                value={isCurrentTrack ? currentTime : 0}
                onChange={(e) => void handleSeek(parseFloat(e.target.value))}
                className={clsx(
                  'w-full h-2 rounded-full cursor-pointer accent-primary',
                  !isCurrentTrack && 'opacity-50 cursor-not-allowed',
                )}
                style={rangeProgressStyle(isCurrentTrack ? currentTime : 0, 0, duration || 1)}
                aria-label="Seek position"
                disabled={!isCurrentTrack}
              />
              <div className="flex justify-between text-xs text-text-muted mt-1 font-mono">
                <span>{formatTime(isCurrentTrack ? currentTime : 0)}</span>
                <span>{formatTime(duration || 0)}</span>
              </div>
            </div>

            {isRepeating && (
              <button
                onClick={handleStopRepeat}
                className="px-3 py-2 rounded-lg bg-primary/20 text-primary text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/30 transition"
              >
                <Repeat1 className="w-4 h-4" />
                Stop Repeat
              </button>
            )}
          </div>

          <p className="text-xs text-text-muted">
            {isCurrentTrack
              ? 'Playing this track'
              : 'Click play to start playback for sync editing'}
          </p>
        </div>

        {/* View selector + actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleViewChange('sync')}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-semibold transition',
                view === 'sync'
                  ? 'bg-white text-black'
                  : 'bg-white/5 text-text-secondary hover:bg-white/10',
              )}
            >
              Sync Editor
            </button>
            <button
              onClick={() => handleViewChange('text')}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-semibold transition',
                view === 'text'
                  ? 'bg-white text-black'
                  : 'bg-white/5 text-text-secondary hover:bg-white/10',
              )}
            >
              Text Editor
            </button>
          </div>

          <div className="flex items-center gap-2">
            {view === 'sync' && (
              <>
                <button
                  onClick={handleUndo}
                  disabled={!canUndo}
                  className={clsx(
                    'p-2 rounded-lg text-xs transition',
                    canUndo
                      ? 'bg-white/5 text-text-secondary hover:bg-white/10'
                      : 'bg-white/5 text-text-muted opacity-50 cursor-not-allowed',
                  )}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={!canRedo}
                  className={clsx(
                    'p-2 rounded-lg text-xs transition',
                    canRedo
                      ? 'bg-white/5 text-text-secondary hover:bg-white/10'
                      : 'bg-white/5 text-text-muted opacity-50 cursor-not-allowed',
                  )}
                  title="Redo (Ctrl+Shift+Z)"
                  aria-label="Redo"
                >
                  <RotateCcw className="w-4 h-4 scale-x-[-1]" />
                </button>
                <button
                  onClick={handleAddLine}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-xs text-text-secondary border border-white/10 hover:bg-white/10 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Line
                </button>
              </>
            )}
            <button
              onClick={onSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black text-xs font-semibold hover:bg-white/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Save
                </>
              )}
            </button>
          </div>
        </div>

        {/* Sync editor */}
        {view === 'sync' && (
          <>
            <p className="text-sm font-semibold text-text-primary">Lines ({lines.length})</p>

            {/* role="list" + role="listitem" make the structure legible to screen
                        readers. aria-current marks the actively playing line. */}
            <div
              ref={listRef}
              role="list"
              aria-label="Lyric lines"
              onScroll={handleScroll}
              className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-1"
            >
              {lines.length === 0 ? (
                <div className="py-8 text-center text-text-muted text-sm">
                  No lyrics yet. Click "Add Line" to start.
                </div>
              ) : (
                lines.map((line, index) => {
                  const isActive = currentLineIndex === index && isCurrentTrack;
                  const isSelected = selectedLineId === line.id;
                  const isEditing = editingId === line.id;

                  return (
                    <div
                      key={line.id}
                      role="listitem"
                      aria-current={isActive ? 'true' : undefined}
                      // Stable ref by ID — replaces children[index] indexing
                      ref={(el) => {
                        if (el) lineRefsMap.current.set(line.id, el);
                        else lineRefsMap.current.delete(line.id);
                      }}
                      onClick={() => !isEditing && handleLineClick(line)}
                      className={clsx(
                        'group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition',
                        isActive && 'bg-primary/20 ring-1 ring-primary/40',
                        isSelected && !isActive && 'bg-white/10',
                        !isActive && !isSelected && 'hover:bg-white/5',
                      )}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetTimestamp(line);
                        }}
                        disabled={!isCurrentTrack}
                        className={clsx(
                          'shrink-0 px-2 py-1 rounded bg-white/10 text-[11px] font-mono transition',
                          isCurrentTrack
                            ? 'text-text-muted hover:bg-white/20 hover:text-primary cursor-pointer'
                            : 'text-text-muted/50 cursor-not-allowed',
                        )}
                        title={isCurrentTrack ? 'Click to set current time' : 'Load track first'}
                        aria-label={`Set timestamp to ${formatTime(currentTime)}`}
                      >
                        {formatLRCTime(line.time)}
                      </button>

                      {isEditing ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                            autoFocus
                            className="flex-1 bg-white/10 rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Edit lyric text"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveEdit();
                            }}
                            className="p-1.5 rounded hover:bg-green-500/20 text-green-400"
                            title="Save (Enter)"
                            aria-label="Save edit"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelEdit();
                            }}
                            className="p-1.5 rounded hover:bg-red-500/20 text-red-400"
                            title="Cancel (Escape)"
                            aria-label="Cancel edit"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* Empty line: use aria-label on the row and render nothing visible.
                                                    Previously rendered italic "Empty line" text which added visual
                                                    noise on songs with many instrumental sections. */}
                          <span
                            className={clsx(
                              'flex-1 text-sm truncate min-h-[1.25rem]',
                              isActive ? 'text-primary font-semibold' : 'text-text-primary',
                            )}
                            aria-label={line.text || 'Empty line'}
                          >
                            {line.text}
                          </span>

                          <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEdit(line);
                              }}
                              className="p-1.5 rounded hover:bg-white/10 text-text-muted hover:text-primary"
                              title="Edit text"
                              aria-label="Edit lyric text"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRepeatLine(line, index);
                              }}
                              className="p-1.5 rounded hover:bg-white/10 text-text-muted hover:text-primary"
                              title="Repeat this line"
                              aria-label="Repeat this line"
                            >
                              <Repeat1 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteLine(line);
                              }}
                              className="p-1.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400"
                              title="Delete line"
                              aria-label="Delete line"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <p className="text-[11px] text-text-muted">
              Space: Play/Pause · Click timestamp: Set time · Click line: Jump to time · Edit: Edit
              text · Repeat: Loop line · Ctrl+Z: Undo
            </p>
          </>
        )}

        {/* Text editor */}
        {view === 'text' && (
          <>
            <textarea
              value={textContent}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={`[00:12.00] Start typing synced lyrics here\n[00:15.50] Each line begins with a timestamp\n[00:19.00] Format: [MM:SS.CS] text`}
              className="w-full panel rounded-xl px-4 py-3 text-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 min-h-[400px]"
              aria-label="LRC lyric content"
            />
            <p className="text-[11px] text-text-muted">
              LRC format: [MM:SS.CS] text — CS = centiseconds (00–99), MS = milliseconds (000–999)
              also accepted. Changes auto-apply after 0.5s. Fix any errors before switching to Sync
              view.
            </p>
          </>
        )}
      </div>
    );
  },
);

LyricsEditor.displayName = 'LyricsEditor';
