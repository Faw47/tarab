import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  GripVertical,
  ListMusic,
  Music2,
  Pause,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatTime } from '../../lib/format-time';
import { useRenderLog } from '../../lib/performance';
import { startPlayback, toggleCurrentPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { resolveActiveQueueIndex, usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { VirtualizedList } from '../shared/VirtualizedList';
import { Button } from '../ui/button';
import { NeoSectionHeader } from '../ui/NeoSectionHeader';

interface QueueViewProps {
  isLibraryLoading?: boolean;
  libraryError?: string | null;
  onRetryLoad?: () => void;
  onScrollChange?: (scrolled: boolean) => void;
}

const UPCOMING_ROW_HEIGHT = 72;
const UPCOMING_VIRTUALIZE_THRESHOLD = 100;
const HISTORY_PREVIEW_COUNT = 12;

const summaryLabel = (queueLength: number, activeIndex: number) => {
  const upcomingCount =
    activeIndex >= 0 ? Math.max(0, queueLength - (activeIndex + 1)) : queueLength;
  const playedCount = activeIndex > 0 ? activeIndex : 0;
  return { upcomingCount, playedCount };
};

export const QueueView = memo(
  ({
    isLibraryLoading = false,
    libraryError = null,
    onRetryLoad,
    onScrollChange,
  }: QueueViewProps) => {
    useRenderLog('QueueView');

    const {
      queue,
      queueIndex,
      currentTrack,
      isPlaying,
      removeFromQueue,
      clearQueue,
      reorderQueue,
    } = usePlayerStore(
      useShallow((state) => ({
        queue: state.queue,
        queueIndex: state.queueIndex,
        currentTrack: state.currentTrack,
        isPlaying: state.isPlaying,
        removeFromQueue: state.removeFromQueue,
        clearQueue: state.clearQueue,
        reorderQueue: state.reorderQueue,
      })),
    );

    const isNeobrutalism = useSettingsStore((s) => s.theme === 'neobrutalism');
    const [showFullHistory, setShowFullHistory] = useState(false);

    const activeIndex = resolveActiveQueueIndex(queue, queueIndex, currentTrack);
    const nowPlayingTrack = activeIndex >= 0 ? queue[activeIndex] : currentTrack;

    const upcomingTracks = activeIndex >= 0 ? queue.slice(activeIndex + 1) : queue;
    const playedTracks = activeIndex > 0 ? queue.slice(0, activeIndex) : [];

    // Added KeyboardSensor for A11y drag & drop
    const sensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: { distance: 6 },
      }),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
      }),
    );

    const totalDuration = useMemo(
      () => queue.reduce((sum, track) => sum + track.duration, 0),
      [queue],
    );

    const upcomingDuration = useMemo(
      () => upcomingTracks.reduce((sum, track) => sum + track.duration, 0),
      [upcomingTracks],
    );

    const { upcomingCount, playedCount } = summaryLabel(queue.length, activeIndex);
    const playedRatio = queue.length > 0 ? Math.min(1, playedCount / queue.length) : 0;

    const handlePlayTrack = useCallback(
      async (track: Track, absoluteIndex: number) => {
        try {
          await startPlayback(track, {
            queue,
            queueIndex: absoluteIndex >= 0 ? absoluteIndex : 0,
          });
        } catch (error) {
          reportError('Failed to play selected queue track', { source: 'queue-view', error });
        }
      },
      [queue],
    );

    const handleToggleCurrent = useCallback(async () => {
      if (!nowPlayingTrack) return;
      try {
        await toggleCurrentPlayback();
      } catch (error) {
        reportError('Failed to toggle queue playback', { source: 'queue-view', error });
      }
    }, [nowPlayingTrack]);

    const handleDragEnd = useCallback(
      (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldLocalIndex = upcomingTracks.findIndex(
          (track) => (track._queueId || track.id) === active.id,
        );
        const newLocalIndex = upcomingTracks.findIndex(
          (track) => (track._queueId || track.id) === over.id,
        );
        if (oldLocalIndex < 0 || newLocalIndex < 0) return;

        const offset = activeIndex >= 0 ? activeIndex + 1 : 0;
        reorderQueue(oldLocalIndex + offset, newLocalIndex + offset);
      },
      [activeIndex, reorderQueue, upcomingTracks],
    );

    const handleRemoveUpcoming = useCallback(
      (localIndex: number) => {
        const offset = activeIndex >= 0 ? activeIndex + 1 : 0;
        removeFromQueue(localIndex + offset);
      },
      [activeIndex, removeFromQueue],
    );

    const historyVisible = showFullHistory
      ? [...playedTracks].reverse()
      : [...playedTracks.slice(-HISTORY_PREVIEW_COUNT)].reverse();

    if (isLibraryLoading) {
      return (
        <div
          className="custom-scrollbar h-full overflow-y-auto pb-36"
          onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop > 8)}
        >
          <div className="mx-auto w-full max-w-5xl space-y-4 px-6 py-6 sm:px-8 lg:py-8">
            <div className="skeleton-shimmer h-7 w-40 rounded-xl" />
            <div className="skeleton-shimmer h-32 rounded-[22px]" />
            <div className="skeleton-shimmer h-[60vh] rounded-[22px]" />
          </div>
        </div>
      );
    }

    if (libraryError) {
      return (
        <div
          className="custom-scrollbar h-full overflow-y-auto pb-36"
          onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop > 8)}
        >
          <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:px-8">
            <section className="glass-panel-strong rounded-[22px] p-7 text-center">
              <p className="text-lg font-semibold text-text-primary">Could not load queue</p>
              <p className="mx-auto mt-2 max-w-[48ch] text-sm text-text-secondary">
                {libraryError}
              </p>
              {onRetryLoad && (
                <Button className="mt-5" onClick={onRetryLoad}>
                  Retry
                </Button>
              )}
            </section>
          </div>
        </div>
      );
    }

    if (isNeobrutalism) {
      return (
        <div
          className="custom-scrollbar h-full overflow-y-auto bg-transparent pb-36"
          onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop > 8)}
        >
          <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6 sm:px-8 lg:py-8">
            <header className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_#000] sm:p-5">
              <div className="flex items-start justify-between">
                <div>
                  <NeoSectionHeader emoji="📋" label="QUEUE" />
                  <p className="mt-3 font-mono text-xs font-black uppercase tracking-[0.08em] text-black/70">
                    {queue.length} tracks • {formatTime(totalDuration)}
                  </p>
                </div>
                {queue.length > 0 && (
                  <button
                    type="button"
                    onClick={clearQueue}
                    className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.08em] shadow-[4px_4px_0_0_#000] transition-none hover:bg-[var(--signal-danger)] hover:text-white active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2.5} />
                    Clear queue
                  </button>
                )}
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <NeoSummaryBox label="Up next" value={upcomingCount.toString()} icon={ListMusic} />
                <NeoSummaryBox label="Played" value={playedCount.toString()} icon={Clock3} />
                <NeoSummaryBox
                  label="Remaining time"
                  value={formatTime(upcomingDuration)}
                  icon={Music2}
                />
              </div>
              <div className="mt-5 h-4 border-2 border-black bg-white p-[2px]">
                {/* Brutalist striped progress bar */}
                <div
                  className="h-full bg-[var(--signal-play)] transition-[width] duration-500 ease-out"
                  style={{
                    width: `${playedRatio * 100}%`,
                    backgroundImage:
                      'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.15) 10px, rgba(0,0,0,0.15) 20px)',
                  }}
                />
              </div>
            </header>

            {queue.length === 0 && (
              <section
                className="border-2 border-black bg-[var(--signal-active)] p-8 text-center shadow-[4px_4px_0_0_#000]"
                role="status"
              >
                <p className="font-mono text-lg font-black uppercase tracking-tight text-black">
                  NOTHING QUEUED
                </p>
                <p className="mt-2 text-sm font-bold uppercase tracking-widest text-black/70">
                  Drop a track to start
                </p>
              </section>
            )}

            {nowPlayingTrack && (
              <section className="relative border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000] sm:p-5">
                <div className="flex items-center gap-4">
                  <CoverArtImage
                    track={nowPlayingTrack}
                    variant="album"
                    className="h-20 w-20 shrink-0 border-2 border-black shadow-[2px_2px_0_0_#000]"
                    imgClassName="h-full w-full object-cover"
                    iconClassName="h-8 w-8"
                    alt={nowPlayingTrack.album}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--signal-danger)]">
                      Now playing
                    </p>
                    <p className="mt-1 truncate text-lg font-black uppercase tracking-tight text-black">
                      {nowPlayingTrack.title}
                    </p>
                    <p className="truncate text-xs font-bold uppercase tracking-[0.08em] text-black/60">
                      {nowPlayingTrack.artist} • {nowPlayingTrack.album}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleCurrent}
                    className="flex h-14 w-14 shrink-0 items-center justify-center border-2 border-black bg-[var(--signal-active)] text-black shadow-[4px_4px_0_0_#000] transition-none hover:bg-black hover:text-[var(--signal-active)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                    aria-label={isPlaying ? 'Pause current track' : 'Play current track'}
                  >
                    {isPlaying ? (
                      <Pause className="h-7 w-7 fill-current" strokeWidth={2.5} />
                    ) : (
                      <Play className="ml-1 h-7 w-7 fill-current" strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              </section>
            )}

            {upcomingTracks.length > 0 && (
              <section className="border-2 border-black bg-[var(--neo-panel)] p-3 shadow-[4px_4px_0_0_#000] sm:p-4">
                <div className="sticky top-0 z-10 mb-3 flex items-center justify-between border-b-2 border-black pb-2 px-1 backdrop-blur-md bg-[var(--neo-panel)]/90">
                  <h2 className="text-sm font-black uppercase tracking-[0.1em] text-black">
                    Up next
                  </h2>
                  <p className="font-mono text-xs font-black text-black/60">
                    {upcomingTracks.length} tracks
                  </p>
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={upcomingTracks.map((track) => track._queueId || track.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {upcomingTracks.length >= UPCOMING_VIRTUALIZE_THRESHOLD ? (
                      <VirtualizedList
                        items={upcomingTracks}
                        itemHeight={UPCOMING_ROW_HEIGHT}
                        overscan={8}
                        className="custom-scrollbar h-[56vh] overflow-auto pr-3"
                        getItemKey={(track) => track._queueId || track.id}
                        renderItem={(track, localIndex) => (
                          <SortableUpcomingRow
                            key={track._queueId || track.id}
                            track={track}
                            position={localIndex + 1}
                            isNeobrutalism
                            onPlay={() => {
                              const absoluteIndex =
                                (activeIndex >= 0 ? activeIndex + 1 : 0) + localIndex;
                              void handlePlayTrack(track, absoluteIndex);
                            }}
                            onRemove={() => handleRemoveUpcoming(localIndex)}
                          />
                        )}
                      />
                    ) : (
                      <div className="custom-scrollbar max-h-[56vh] space-y-2 overflow-auto pr-3 pt-1">
                        {upcomingTracks.map((track, localIndex) => (
                          <SortableUpcomingRow
                            key={track._queueId || track.id}
                            track={track}
                            position={localIndex + 1}
                            isNeobrutalism
                            onPlay={() => {
                              const absoluteIndex =
                                (activeIndex >= 0 ? activeIndex + 1 : 0) + localIndex;
                              void handlePlayTrack(track, absoluteIndex);
                            }}
                            onRemove={() => handleRemoveUpcoming(localIndex)}
                          />
                        ))}
                      </div>
                    )}
                  </SortableContext>
                </DndContext>
              </section>
            )}

            {playedTracks.length > 0 && (
              <section className="border-2 border-black bg-[var(--neo-panel)] p-3 shadow-[4px_4px_0_0_#000] sm:p-4">
                <div className="sticky top-0 z-10 mb-3 flex items-center justify-between border-b-2 border-black pb-2 px-1 backdrop-blur-md bg-[var(--neo-panel)]/90">
                  <h2 className="text-sm font-black uppercase tracking-[0.1em] text-black">
                    Played
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowFullHistory((prev) => !prev)}
                    className="border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase shadow-[4px_4px_0_0_#000] transition-none hover:bg-[var(--signal-active)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                  >
                    {showFullHistory ? 'Less' : 'All'}
                  </button>
                </div>
                <div className="space-y-2 pt-1">
                  {historyVisible.map((track, historyIndex) => {
                    const absoluteIndex = activeIndex - 1 - historyIndex;
                    return (
                      <HistoryRow
                        key={track._queueId || `${track.id}-${absoluteIndex}`}
                        track={track}
                        isNeobrutalism
                        onReplay={() => {
                          void handlePlayTrack(track, absoluteIndex);
                        }}
                        onRemove={() => removeFromQueue(absoluteIndex)}
                      />
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      );
    }

    // --- Glassmorphism Theme (Default) ---
    return (
      <div
        className="custom-scrollbar h-full overflow-y-auto pb-36"
        onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop > 8)}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 sm:px-7 lg:py-8">
          <header className="rounded-[22px] border border-white/[0.08] bg-white/[0.02] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_18px_34px_-28px_rgba(8,6,4,0.78)] backdrop-blur-[24px]">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-3xl font-extrabold tracking-tight text-white">Queue</h1>
                <p className="mt-1.5 text-sm font-medium text-white/60">
                  {queue.length} tracks • {formatTime(totalDuration)} total
                </p>
              </div>

              {queue.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearQueue}
                  className="h-10 rounded-full bg-white/[0.08] px-5 text-xs font-semibold text-white/80 transition-all hover:bg-red-500/20 hover:text-red-200"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear queue
                </Button>
              )}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SummaryChip label="Up next" value={`${upcomingCount} tracks`} icon={ListMusic} />
              <SummaryChip label="Played" value={`${playedCount} tracks`} icon={Clock3} />
              <SummaryChip label="Remaining" value={formatTime(upcomingDuration)} icon={Music2} />
            </div>

            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/[0.08] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${Math.max(2, playedRatio * 100)}%`,
                  background:
                    'linear-gradient(90deg, var(--hero-accent) 0%, color-mix(in srgb, var(--hero-accent) 60%, white 40%) 100%)',
                  boxShadow: '0 0 12px var(--hero-glow)',
                }}
              />
            </div>
          </header>

          {queue.length === 0 ? (
            <section className="flex flex-col items-center justify-center rounded-[22px] border border-white/[0.06] bg-white/[0.02] py-24 text-center backdrop-blur-md">
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[18px] bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
                <Music2 className="h-10 w-10 text-white/60" />
              </div>
              <h3 className="text-xl font-semibold text-white">Your queue is empty</h3>
              <p className="mt-2.5 max-w-sm text-sm font-medium text-white/60">
                Start playback from your library, playlists, or album views to build a queue.
              </p>
            </section>
          ) : (
            <section className="flex flex-col gap-6">
              {nowPlayingTrack && (
                <article className="group relative flex min-h-[100px] items-center gap-5 overflow-hidden rounded-[22px] border border-white/[0.12] bg-white/[0.04] p-4 pl-5 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
                  {/* Background blur from cover art */}
                  {nowPlayingTrack.coverArt && (
                    <div
                      className="absolute inset-0 z-0 opacity-20 blur-[40px]"
                      style={{
                        backgroundImage: `url(${nowPlayingTrack.coverArt})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    />
                  )}
                  <div className="pointer-events-none absolute -inset-24 z-0 bg-[var(--hero-accent)] opacity-[0.08] blur-[60px]" />

                  <CoverArtImage
                    track={nowPlayingTrack}
                    className="relative z-10 h-16 w-16 shrink-0 shadow-xl"
                    imgClassName="h-full w-full object-cover"
                    roundedClassName="rounded-xl"
                    iconClassName="h-7 w-7"
                    alt={nowPlayingTrack.album}
                  />

                  <div className="relative z-10 min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2.5">
                      <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/90 shadow-[0_0_10px_var(--hero-glow)] backdrop-blur-md">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--hero-accent)] animate-pulse shadow-[0_0_8px_var(--hero-accent)]" />
                        Now playing
                      </span>
                      <span className="text-xs font-semibold text-white/60">
                        {activeIndex >= 0
                          ? `${activeIndex + 1} of ${queue.length}`
                          : `${queue.length} tracks`}
                      </span>
                    </div>
                    <p className="truncate text-lg font-bold text-white tracking-tight">
                      {nowPlayingTrack.title}
                    </p>
                    <p className="truncate text-sm font-medium text-white/60 mt-0.5">
                      {nowPlayingTrack.artist} • {nowPlayingTrack.album}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleCurrent}
                    className="relative z-10 flex h-14 w-14 items-center justify-center shrink-0 rounded-full bg-white text-black shadow-[0_0_20px_var(--hero-glow)] transition-all hover:scale-[1.05] active:scale-[0.95]"
                    aria-label={isPlaying ? 'Pause current track' : 'Play current track'}
                  >
                    {isPlaying ? (
                      <Pause className="h-6 w-6 fill-current" />
                    ) : (
                      <Play className="ml-1 h-6 w-6 fill-current" />
                    )}
                  </button>
                </article>
              )}

              {upcomingTracks.length > 0 ? (
                <div className="rounded-[22px] border border-white/[0.04] bg-white/[0.015] p-2 backdrop-blur-md">
                  <div className="sticky top-0 z-10 -mx-2 -mt-2 mb-2 flex items-center justify-between rounded-t-[22px] bg-[#0a0a0a]/80 px-5 py-4 backdrop-blur-xl border-b border-white/[0.04]">
                    <span className="text-sm font-bold uppercase tracking-widest text-white/90">
                      Up next
                    </span>
                    <span className="text-xs font-medium text-white/60">
                      {upcomingTracks.length} tracks • drag to reorder
                    </span>
                  </div>

                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={upcomingTracks.map((track) => track._queueId || track.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {upcomingTracks.length >= UPCOMING_VIRTUALIZE_THRESHOLD ? (
                        <VirtualizedList
                          items={upcomingTracks}
                          itemHeight={UPCOMING_ROW_HEIGHT}
                          overscan={8}
                          className="custom-scrollbar h-[50vh] overflow-auto pr-3"
                          getItemKey={(track) => track._queueId || track.id}
                          renderItem={(track, localIndex) => (
                            <SortableUpcomingRow
                              key={track._queueId || track.id}
                              track={track}
                              position={localIndex + 1}
                              onPlay={() => {
                                const absoluteIndex =
                                  (activeIndex >= 0 ? activeIndex + 1 : 0) + localIndex;
                                void handlePlayTrack(track, absoluteIndex);
                              }}
                              onRemove={() => handleRemoveUpcoming(localIndex)}
                            />
                          )}
                        />
                      ) : (
                        <div className="custom-scrollbar max-h-[50vh] space-y-1.5 overflow-auto pr-3">
                          {upcomingTracks.map((track, localIndex) => (
                            <SortableUpcomingRow
                              key={track._queueId || track.id}
                              track={track}
                              position={localIndex + 1}
                              onPlay={() => {
                                const absoluteIndex =
                                  (activeIndex >= 0 ? activeIndex + 1 : 0) + localIndex;
                                void handlePlayTrack(track, absoluteIndex);
                              }}
                              onRemove={() => handleRemoveUpcoming(localIndex)}
                            />
                          ))}
                        </div>
                      )}
                    </SortableContext>
                  </DndContext>
                </div>
              ) : (
                <div className="rounded-[22px] border border-white/[0.04] bg-white/[0.015] px-5 py-8 text-center text-sm font-medium text-white/60 backdrop-blur-md">
                  Nothing else is queued after the current track.
                </div>
              )}

              {playedTracks.length > 0 && (
                <div className="rounded-[22px] border border-white/[0.04] bg-white/[0.015] p-2 backdrop-blur-md">
                  <div className="sticky top-0 z-10 -mx-2 -mt-2 mb-2 flex items-center justify-between rounded-t-[22px] bg-[#0a0a0a]/80 px-5 py-3 backdrop-blur-xl border-b border-white/[0.04]">
                    <span className="text-sm font-bold uppercase tracking-widest text-white/90">
                      Played
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowFullHistory((prev) => !prev)}
                      className="h-8 rounded-full bg-white/[0.06] px-4 text-xs font-semibold text-white/70 hover:bg-white/[0.12] hover:text-white"
                    >
                      {showFullHistory ? (
                        <>
                          <ChevronUp className="mr-1.5 h-4 w-4" />
                          Less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="mr-1.5 h-4 w-4" />
                          All
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    {historyVisible.map((track, historyIndex) => {
                      const absoluteIndex = activeIndex - 1 - historyIndex;
                      return (
                        <HistoryRow
                          key={track._queueId || `${track.id}-${absoluteIndex}`}
                          track={track}
                          onReplay={() => {
                            void handlePlayTrack(track, absoluteIndex);
                          }}
                          onRemove={() => removeFromQueue(absoluteIndex)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    );
  },
);

interface SummaryChipProps {
  label: string;
  value: string;
  icon: typeof Music2;
}

const SummaryChip = memo(({ label, value, icon: Icon }: SummaryChipProps) => (
  <div
    className={clsx(
      'relative group flex items-center gap-4 p-5 rounded-[18px] overflow-hidden cursor-default isolate',
      'bg-gradient-to-b from-white/[0.08] to-white/[0.03]',
      'hover:from-white/[0.12] hover:to-white/[0.05]',
      'transition-all duration-300',
    )}
  >
    <div
      className="absolute -left-2 top-1/2 -translate-y-1/2 w-16 h-16 rounded-full blur-[22px] pointer-events-none opacity-0 group-hover:opacity-40 transition-opacity duration-500"
      style={{ background: 'var(--hero-accent)' }}
    />
    <div
      className="relative isolate shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-[1.07]"
      style={{
        background: `linear-gradient(180deg, color-mix(in oklch, var(--hero-accent) 40%, rgba(255,255,255,0.15)) 0%, color-mix(in oklch, var(--hero-accent) 20%, rgba(255,255,255,0.05)) 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.2)`,
      }}
    >
      <Icon className="w-5 h-5 shrink-0 text-white drop-shadow-md" />
    </div>
    <div className="min-w-0">
      <p className="font-display font-extrabold text-white tabular-nums leading-none tracking-tight text-xl">
        {value}
      </p>
      <p className="text-[9.5px] font-bold uppercase tracking-[0.24em] text-white/50 mt-[5px]">
        {label}
      </p>
    </div>
    <div
      className="absolute bottom-0 left-4 right-4 h-[1.5px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      style={{ background: `linear-gradient(90deg, transparent, var(--hero-accent), transparent)` }}
    />
  </div>
));
SummaryChip.displayName = 'SummaryChip';

interface NeoSummaryBoxProps {
  label: string;
  value: string;
  icon: typeof Music2;
}

const NeoSummaryBox = memo(({ label, value, icon: Icon }: NeoSummaryBoxProps) => (
  <div className="border-2 border-black bg-white px-3 py-2.5 shadow-[4px_4px_0_0_#000]">
    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-black/60">
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      <span>{label}</span>
    </div>
    <p className="mt-1 font-mono text-sm font-black text-black">{value}</p>
  </div>
));
NeoSummaryBox.displayName = 'NeoSummaryBox';

interface QueueRowBaseProps {
  track: Track;
  position: number;
  onPlay: () => void;
  onRemove: () => void;
  dragHandle?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
  isNeobrutalism?: boolean;
}

const QueueRowBase = memo(
  ({
    track,
    position,
    onPlay,
    onRemove,
    dragHandle,
    isDragging = false,
    isNeobrutalism = false,
  }: QueueRowBaseProps) => (
    <article
      className={clsx(
        'group relative flex h-[72px] items-center gap-4 px-4 transition-all duration-200',
        isNeobrutalism
          ? [
              'border-2 border-black bg-white',
              isDragging
                ? 'shadow-[8px_8px_0_0_#000] z-10'
                : 'shadow-[4px_4px_0_0_#000] hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[6px_6px_0_0_#000] hover:bg-[var(--neo-panel)]',
            ]
          : [
              'rounded-[16px] border border-transparent bg-transparent',
              'hover:border-white/[0.08] hover:bg-white/[0.03]',
              isDragging &&
                'border-white/[0.15] bg-white/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.3)] z-10',
            ],
      )}
    >
      <button
        type="button"
        className={clsx(
          'flex h-8 w-8 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing',
          isNeobrutalism
            ? 'border-2 border-black bg-[var(--neo-panel)] text-black shadow-[2px_2px_0_0_#000]'
            : 'rounded-full text-white/40 transition-colors hover:bg-white/[0.12] group-hover:text-white/80 focus-visible:text-white/80',
        )}
        aria-label={`Drag track ${position}`}
        {...dragHandle}
      >
        <GripVertical className="h-4 w-4" strokeWidth={isNeobrutalism ? 2.5 : 2} />
      </button>

      <p
        className={clsx(
          'w-6 shrink-0 text-center text-[13px] tabular-nums',
          isNeobrutalism
            ? 'font-mono font-black text-black'
            : 'font-semibold text-white/50 group-hover:text-white/90 transition-colors',
        )}
      >
        {position}
      </p>

      <button onClick={onPlay} className="relative shrink-0" aria-label={`Play ${track.title}`}>
        <CoverArtImage
          track={track}
          variant={isNeobrutalism ? 'album' : undefined}
          className="h-12 w-12 shadow-md"
          imgClassName="h-full w-full object-cover transition-transform group-hover:scale-105"
          roundedClassName={isNeobrutalism ? '' : 'rounded-[10px]'}
          iconClassName="h-5 w-5"
          alt={track.album}
        />
        <span
          className={clsx(
            'pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-200 group-hover:opacity-100',
            isNeobrutalism ? 'bg-black/40' : 'rounded-[10px] bg-black/40 backdrop-blur-[2px]',
          )}
        >
          <Play className="ml-0.5 h-4 w-4 fill-current text-white drop-shadow-md" />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            'truncate text-[15px]',
            isNeobrutalism
              ? 'font-black uppercase tracking-tight text-black'
              : 'font-semibold text-white/90',
          )}
        >
          {track.title}
        </p>
        <p
          className={clsx(
            'truncate text-[13px] mt-0.5',
            isNeobrutalism
              ? 'font-bold uppercase tracking-[0.06em] text-black/55'
              : 'font-medium text-white/60',
          )}
        >
          {track.artist} • {track.album}
        </p>
      </div>

      <span
        className={clsx(
          'shrink-0 text-[13px] tabular-nums mr-2',
          isNeobrutalism
            ? 'font-mono font-black text-black/60'
            : 'font-medium text-white/50 group-hover:text-white/70 transition-colors',
        )}
      >
        {formatTime(track.duration)}
      </span>

      <div
        className={clsx(
          'flex items-center gap-2',
          isNeobrutalism
            ? 'opacity-100'
            : 'opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <button
          type="button"
          onClick={onRemove}
          className={clsx(
            'flex h-9 w-9 items-center justify-center transition-all',
            isNeobrutalism
              ? 'border-2 border-black bg-white text-black shadow-[2px_2px_0_0_#000] hover:bg-[var(--signal-danger)] hover:text-white active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
              : 'rounded-full bg-white/[0.06] hover:bg-red-500/30 hover:text-red-200 text-white/60',
          )}
          aria-label="Remove from queue"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </article>
  ),
);
QueueRowBase.displayName = 'QueueRowBase';

interface SortableUpcomingRowProps {
  track: Track;
  position: number;
  onPlay: () => void;
  onRemove: () => void;
  isNeobrutalism?: boolean;
}

const SortableUpcomingRow = memo(
  ({ track, position, onPlay, onRemove, isNeobrutalism = false }: SortableUpcomingRowProps) => {
    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
      id: track._queueId || track.id,
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 3 : undefined,
    };

    return (
      <div ref={setNodeRef} style={style}>
        <QueueRowBase
          track={track}
          position={position}
          onPlay={onPlay}
          onRemove={onRemove}
          dragHandle={{ ...attributes, ...listeners }}
          isDragging={isDragging}
          isNeobrutalism={isNeobrutalism}
        />
      </div>
    );
  },
);
SortableUpcomingRow.displayName = 'SortableUpcomingRow';

interface HistoryRowProps {
  track: Track;
  onReplay: () => void;
  onRemove: () => void;
  isNeobrutalism?: boolean;
}

const HistoryRow = memo(
  ({ track, onReplay, onRemove, isNeobrutalism = false }: HistoryRowProps) => (
    <article
      className={clsx(
        'group flex h-[64px] items-center gap-4 px-4 transition-all duration-200',
        isNeobrutalism
          ? 'border-2 border-black bg-[#EAEAEA] shadow-[2px_2px_0_0_#000] hover:bg-white hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[4px_4px_0_0_#000]'
          : 'rounded-[16px] border border-transparent bg-transparent hover:border-white/[0.06] hover:bg-white/[0.02]',
      )}
    >
      <button onClick={onReplay} className="relative shrink-0" aria-label={`Replay ${track.title}`}>
        <CoverArtImage
          track={track}
          variant={isNeobrutalism ? 'album' : undefined}
          className={clsx(
            'h-11 w-11 shadow-sm',
            !isNeobrutalism && 'opacity-80 group-hover:opacity-100 transition-opacity',
          )}
          imgClassName={clsx(
            'h-full w-full object-cover transition-transform group-hover:scale-105',
            isNeobrutalism && 'grayscale group-hover:grayscale-0 transition-all',
          )}
          roundedClassName={isNeobrutalism ? '' : 'rounded-[10px]'}
          iconClassName="h-4 w-4"
          alt={track.album}
        />
        <span
          className={clsx(
            'pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-200 group-hover:opacity-100',
            isNeobrutalism ? 'bg-black/40' : 'rounded-[10px] bg-black/40 backdrop-blur-[2px]',
          )}
        >
          <Play className="ml-0.5 h-4 w-4 fill-current text-white drop-shadow-md" />
        </span>
      </button>

      <div
        className={clsx(
          'min-w-0 flex-1',
          !isNeobrutalism && 'opacity-90 group-hover:opacity-100 transition-opacity',
        )}
      >
        <p
          className={clsx(
            'truncate text-[14px]',
            isNeobrutalism
              ? 'font-black uppercase tracking-tight text-black/80 group-hover:text-black'
              : 'font-semibold text-white/90',
          )}
        >
          {track.title}
        </p>
        <p
          className={clsx(
            'truncate text-[12px] mt-0.5',
            isNeobrutalism
              ? 'font-bold uppercase tracking-[0.06em] text-black/50'
              : 'font-medium text-white/60',
          )}
        >
          {track.artist}
        </p>
      </div>

      <span
        className={clsx(
          'text-[12px] tabular-nums mr-2',
          isNeobrutalism
            ? 'font-mono font-black text-black/50 group-hover:text-black/70'
            : 'font-medium text-white/50 group-hover:text-white/70 transition-colors',
        )}
      >
        {formatTime(track.duration)}
      </span>

      <div
        className={clsx(
          'flex items-center gap-2',
          isNeobrutalism
            ? 'opacity-100'
            : 'opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <button
          type="button"
          onClick={onReplay}
          className={clsx(
            'flex h-8 w-8 items-center justify-center transition-all',
            isNeobrutalism
              ? 'border-2 border-black bg-[var(--signal-active)] shadow-[2px_2px_0_0_#000] hover:-translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
              : 'rounded-full bg-white/[0.06] text-white/70 hover:bg-white/[0.15] hover:text-white',
          )}
          aria-label="Replay track"
        >
          <Play className="ml-0.5 h-4 w-4 fill-current" strokeWidth={isNeobrutalism ? 2.5 : 2.5} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className={clsx(
            'flex h-8 w-8 items-center justify-center transition-all',
            isNeobrutalism
              ? 'border-2 border-black bg-white shadow-[2px_2px_0_0_#000] hover:bg-[var(--signal-danger)] hover:text-white hover:-translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
              : 'rounded-full bg-white/[0.06] text-white/70 hover:bg-red-500/30 hover:text-red-200',
          )}
          aria-label="Remove from queue history"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </article>
  ),
);
HistoryRow.displayName = 'HistoryRow';

QueueView.displayName = 'QueueView';
