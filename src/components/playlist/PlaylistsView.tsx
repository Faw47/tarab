import {
  Check,
  ChevronDown,
  ChevronUp,
  ListMusic,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useCreatePlaylistMutation,
  useDeletePlaylistMutation,
  usePinPlaylistMutation,
  useRelinkPlaylistTrackMutation,
  useRemoveMissingTracksMutation,
  useRemoveTracksMutation,
  useReorderPlaylistTracksMutation,
  useSyncPlaylistMutation,
  useUpdatePlaylistMutation,
} from '../../features/playlists/mutations';
import { usePlaylistDetailQuery, usePlaylistsQuery } from '../../features/playlists/queries';
import { startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { refreshTracksByFilePaths } from '../../lib/track-refresh';
import { dialog } from '../../platform/dialog';
import { useSettingsStore } from '../../store/settings-store';
import type { PlaylistEntry, Track } from '../../types';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Input } from '../ui/Input';
import { StatePanel } from '../ui/StatePanel';
import { PlaylistEditorDialog } from './PlaylistEditorDialog';
import { usePlaylistTrackSelection } from './usePlaylistTrackSelection';

export function PlaylistsView() {
  const theme = useSettingsStore((state) => state.theme);
  const neo = theme === 'neobrutalism';
  const playlists = usePlaylistsQuery();
  const createPlaylist = useCreatePlaylistMutation();
  const deletePlaylist = useDeletePlaylistMutation();
  const pinPlaylist = usePinPlaylistMutation();
  const syncPlaylist = useSyncPlaylistMutation();
  const updatePlaylist = useUpdatePlaylistMutation();
  const removeTracks = useRemoveTracksMutation();
  const reorderTracks = useReorderPlaylistTracksMutation();
  const removeMissing = useRemoveMissingTracksMutation();
  const relinkTrack = useRelinkPlaylistTrackMutation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null);
  const [inlineRenameValue, setInlineRenameValue] = useState('');
  const [inlineRenameError, setInlineRenameError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setQuery('');
    setInlineRenameId(null);
    setInlineRenameValue('');
    setInlineRenameError(null);
  }, [selectedId]);
  const [relinkingTrackId, setRelinkingTrackId] = useState<string | null>(null);
  const [category, setCategory] = useState<
    'all' | 'pinned' | 'recent' | 'smart' | 'folder' | 'standard'
  >('all');
  const [deletePending, setDeletePending] = useState(false);
  const detail = usePlaylistDetailQuery(selectedId);
  const ordered = useMemo(
    () =>
      [...(playlists.data ?? [])].sort(
        (left, right) =>
          Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned)) ||
          right.updatedAt - left.updatedAt,
      ),
    [playlists.data],
  );
  const visibleEntries = useMemo(() => {
    const entries = detail.data?.entries ?? [];
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.artist, entry.album].some((value) =>
        value?.toLocaleLowerCase().includes(needle),
      ),
    );
  }, [detail.data?.entries, query]);
  const categoryCounts = useMemo(() => {
    const now = Date.now();
    const recentCutoff = now - 30 * 24 * 60 * 60 * 1000;
    return {
      all: ordered.length,
      pinned: ordered.filter((playlist) => playlist.isPinned).length,
      recent: ordered.filter((playlist) => playlist.updatedAt >= recentCutoff).length,
      smart: ordered.filter((playlist) => playlist.playlistType === 'Smart').length,
      folder: ordered.filter((playlist) => playlist.playlistType === 'FolderSync').length,
      standard: ordered.filter((playlist) => playlist.playlistType === 'Manual').length,
    };
  }, [ordered]);
  const visiblePlaylists = useMemo(() => {
    if (category === 'all') return ordered;
    if (category === 'pinned') return ordered.filter((playlist) => playlist.isPinned);
    if (category === 'recent') {
      const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return ordered.filter((playlist) => playlist.updatedAt >= recentCutoff);
    }
    if (category === 'smart') {
      return ordered.filter((playlist) => playlist.playlistType === 'Smart');
    }
    if (category === 'folder') {
      return ordered.filter((playlist) => playlist.playlistType === 'FolderSync');
    }
    return ordered.filter((playlist) => playlist.playlistType === 'Manual');
  }, [category, ordered]);

  const playableTracks = useMemo(
    () =>
      (detail.data?.entries ?? [])
        .filter(
          (entry): entry is PlaylistEntry & { filePath: string } =>
            entry.available && Boolean(entry.filePath),
        )
        .map(
          (entry): Track => ({
            id: entry.trackId,
            title: entry.title ?? 'Unknown track',
            artist: entry.artist ?? 'Unknown artist',
            album: entry.album ?? 'Unknown album',
            year: null,
            duration: entry.duration ?? 0,
            filePath: entry.filePath,
            hasCoverArt: entry.hasCoverArt,
            coverArtHash: entry.coverArtHash ?? null,
            blurhash: entry.blurhash ?? null,
            dateAdded: detail.data?.updatedAt ?? Date.now(),
          }),
        ),
    [detail.data],
  );

  const canEditTracks = detail.data?.playlistType === 'Manual';

  const playTrack = useCallback(
    (track: Track, queueIndex: number) => {
      void startPlayback(track, {
        queue: playableTracks,
        queueIndex,
      }).catch((error) => {
        reportError('Failed to play playlist', {
          source: 'playlists-view',
          error,
        });
      });
    },
    [playableTracks],
  );

  const playEntry = useCallback(
    (entry: PlaylistEntry) => {
      const queueIndex = playableTracks.findIndex((track) => track.id === entry.trackId);
      const track = queueIndex >= 0 ? playableTracks[queueIndex] : undefined;
      if (track) playTrack(track, queueIndex);
    },
    [playTrack, playableTracks],
  );

  const removeSelectedTracks = useCallback(
    (trackIds: string[]) => {
      if (!detail.data || !canEditTracks || trackIds.length === 0 || removeTracks.isPending) {
        return;
      }
      void removeTracks
        .mutateAsync({
          playlistId: detail.data.id,
          trackIds,
        })
        .then(() => setSelectedTrackIds(new Set()))
        .catch((error) => {
          reportError('Could not remove tracks from the playlist', {
            source: 'playlists-view',
            error,
          });
        });
    },
    [canEditTracks, detail.data, removeTracks],
  );

  const playlistTracksListRef = useRef<HTMLOListElement | null>(null);

  const {
    focusedIndex,
    handleEntryToggle,
    handleListKeyDown,
    selectedTrackIds: selectedPlaylistTrackIds,
  } = usePlaylistTrackSelection({
    entries: visibleEntries,
    allEntries: detail.data?.entries,
    resetKey: selectedId,
    selectedTrackIds,
    onSelectionChange: setSelectedTrackIds,
    allowSelection: canEditTracks,
    onPlayEntry: playEntry,
    onRemoveSelected: removeSelectedTracks,
  });
  const startInlineRename = useCallback(() => {
    if (!detail.data) return;
    setInlineRenameId(detail.data.id);
    setInlineRenameValue(detail.data.name);
    setInlineRenameError(null);
  }, [detail.data]);

  const cancelInlineRename = useCallback(() => {
    setInlineRenameId(null);
    setInlineRenameValue('');
    setInlineRenameError(null);
  }, []);

  const saveInlineRename = useCallback(async () => {
    if (!detail.data || inlineRenameId !== detail.data.id || updatePlaylist.isPending) {
      return;
    }
    const name = inlineRenameValue.trim();
    if (!name) {
      setInlineRenameError('Playlist name is required.');
      return;
    }
    if (name === detail.data.name) {
      cancelInlineRename();
      return;
    }

    try {
      await updatePlaylist.mutateAsync({
        playlistId: detail.data.id,
        name,
      });
      cancelInlineRename();
    } catch (error) {
      setInlineRenameError('Could not rename the playlist.');
      reportError('Could not rename the playlist', {
        source: 'playlists-view',
        error,
      });
    }
  }, [cancelInlineRename, detail.data, inlineRenameId, inlineRenameValue, updatePlaylist]);
  useEffect(() => {
    if (focusedIndex < 0) return;
    const row = playlistTracksListRef.current?.children[focusedIndex];
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);
  const moveEntry = async (trackId: string, direction: -1 | 1) => {
    if (!detail.data || reorderTracks.isPending) return;
    const ids = detail.data.entries.map((entry) => entry.trackId);
    const from = ids.indexOf(trackId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];

    try {
      await reorderTracks.mutateAsync({ playlistId: detail.data.id, trackIds: ids });
    } catch (error) {
      reportError('Could not reorder the playlist', {
        source: 'playlists-view',
        error,
      });
    }
  };

  const relinkEntry = async (entry: PlaylistEntry) => {
    if (!detail.data) return;
    const selection = await dialog.openAudioFiles('Choose the replacement audio file');
    const replacementPath = selection?.[0];
    if (!replacementPath) return;
    setRelinkingTrackId(entry.trackId);
    try {
      await refreshTracksByFilePaths([replacementPath]);
      await relinkTrack.mutateAsync({
        playlistId: detail.data.id,
        oldTrackId: entry.trackId,
        newTrackId: replacementPath,
      });
    } catch (error) {
      reportError('Could not relink the playlist track', {
        source: 'playlists-view',
        error,
      });
    } finally {
      setRelinkingTrackId(null);
    }
  };

  return (
    <main className="h-full overflow-y-auto px-6 pb-36 pt-8" aria-labelledby="playlists-title">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex items-center justify-between gap-4">
          <div>
            <h1 id="playlists-title" className="text-3xl font-black text-text-primary">
              Playlists
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Manual, smart, and folder-synced collections.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New playlist
          </Button>
        </header>

        {playlists.isError ? (
          <StatePanel
            tone="error"
            title="Tarab could not load playlists."
            action={{
              label: 'Retry',
              onClick: () => {
                void playlists.refetch();
              },
            }}
            className="rounded-xl"
          />
        ) : ordered.length === 0 && !playlists.isLoading ? (
          <section className="grid min-h-72 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <div>
              <ListMusic className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
              <h2 className="text-xl font-bold text-text-primary">Create your first playlist</h2>
              <p className="mt-2 text-sm text-text-secondary">
                Start with a manual playlist, rules, or a synced folder.
              </p>
              <Button className="mt-5" onClick={() => setCreateOpen(true)}>
                Create playlist
              </Button>
            </div>
          </section>
        ) : (
          <>
            <nav className="mb-5 flex flex-wrap gap-2" aria-label="Playlist categories">
              {(
                [
                  ['all', 'All'],
                  ['pinned', 'Pinned'],
                  ['recent', 'Recent'],
                  ['smart', 'Smart'],
                  ['folder', 'Folder synced'],
                  ['standard', 'Standard'],
                ] as const
              ).map(([id, label]) => (
                <Button
                  key={id}
                  variant={category === id ? 'default' : 'secondary'}
                  aria-pressed={category === id}
                  onClick={() => setCategory(id)}
                >
                  {label} {categoryCounts[id]}
                </Button>
              ))}
            </nav>
            <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.42fr)_1fr]">
              <section aria-label="Playlist list" className="space-y-2">
                {visiblePlaylists.length === 0 ? (
                  <p className="rounded-xl border border-white/10 p-4 text-sm text-text-secondary">
                    No playlists are in this category.
                  </p>
                ) : null}
                {visiblePlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() => setSelectedId(playlist.id)}
                    className={`w-full border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      neo
                        ? 'border-black bg-white text-black shadow-[var(--neo-shadow-md)]'
                        : 'rounded-xl border-white/10 bg-white/[0.04] text-text-primary hover:bg-white/[0.07]'
                    } ${selectedId === playlist.id ? 'ring-2 ring-primary' : ''}`}
                  >
                    <span className="flex items-center gap-2 font-bold">
                      {playlist.isPinned ? <Pin className="h-3.5 w-3.5" /> : null}
                      {playlist.name}
                    </span>
                    <span className="mt-1 block text-xs opacity-70">
                      {playlist.trackCount} tracks · {playlist.playlistType}
                      {playlist.missingCount > 0 ? ` · ${playlist.missingCount} unavailable` : ''}
                    </span>
                  </button>
                ))}
              </section>

              <section
                aria-live="polite"
                className={`min-h-72 border p-5 ${
                  neo
                    ? 'border-black bg-white text-black'
                    : 'rounded-2xl border-white/10 bg-white/[0.03]'
                }`}
              >
                {!selectedId ? (
                  <p className="text-sm text-text-secondary">
                    Select a playlist to view its tracks.
                  </p>
                ) : detail.isLoading ? (
                  <p role="status">Loading playlist…</p>
                ) : detail.data ? (
                  <>
                    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        {inlineRenameId === detail.data.id ? (
                          <form
                            className="flex max-w-full flex-wrap items-center gap-2"
                            aria-busy={updatePlaylist.isPending || undefined}
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveInlineRename();
                            }}
                          >
                            <Input
                              value={inlineRenameValue}
                              onChange={(event) => {
                                setInlineRenameValue(event.target.value);
                                if (inlineRenameError) setInlineRenameError(null);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelInlineRename();
                                }
                              }}
                              aria-label="Rename playlist"
                              autoFocus
                              className="h-9 min-w-0 max-w-full flex-1 rounded-lg border border-current/20 bg-transparent px-2 text-lg font-black"
                            />
                            <button
                              type="submit"
                              disabled={updatePlaylist.isPending}
                              aria-label="Save playlist name"
                              title="Save playlist name"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/15 hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelInlineRename}
                              disabled={updatePlaylist.isPending}
                              aria-label="Cancel playlist rename"
                              title="Cancel playlist rename"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/15 hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <X className="h-4 w-4" />
                            </button>
                            {inlineRenameError ? (
                              <p
                                className="basis-full text-xs text-[var(--state-error-ink)]"
                                role="alert"
                              >
                                {inlineRenameError}
                              </p>
                            ) : null}
                          </form>
                        ) : (
                          <div className="flex min-w-0 items-center gap-2">
                            <h2 className="truncate text-xl font-black">{detail.data.name}</h2>
                            <button
                              type="button"
                              onClick={startInlineRename}
                              aria-label="Rename playlist"
                              title="Rename playlist"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/15 opacity-70 hover:bg-current/10 hover:opacity-100"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                        {detail.data.folderPath ? (
                          <>
                            <p className="mt-1 break-all text-xs opacity-70">
                              Source: {detail.data.folderPath}
                            </p>
                            <p className="mt-1 text-xs opacity-70">
                              {detail.data.lastSyncedAt
                                ? `Last synced ${new Date(detail.data.lastSyncedAt).toLocaleString()}`
                                : 'Not synced yet'}
                            </p>
                          </>
                        ) : null}
                        {detail.data.syncError ? (
                          <p className="mt-2 text-sm text-[var(--state-error-ink)]" role="alert">
                            {detail.data.syncError}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={playableTracks.length === 0}
                          onClick={() => {
                            const first = playableTracks[0];
                            if (first) playTrack(first, 0);
                          }}
                        >
                          <Play className="h-4 w-4" /> Play
                        </Button>
                        <Button variant="secondary" onClick={() => setEditOpen(true)}>
                          <Pencil className="h-4 w-4" /> Edit
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={pinPlaylist.isPending}
                          onClick={() => {
                            void pinPlaylist
                              .mutateAsync({
                                playlistId: detail.data.id,
                                isPinned: !detail.data.isPinned,
                              })
                              .catch((error) => {
                                reportError('Could not update playlist pin', {
                                  source: 'playlists-view',
                                  error,
                                });
                              });
                          }}
                        >
                          {detail.data.isPinned ? (
                            <PinOff className="h-4 w-4" />
                          ) : (
                            <Pin className="h-4 w-4" />
                          )}
                          {detail.data.isPinned ? 'Unpin' : 'Pin'}
                        </Button>
                        {detail.data.missingCount > 0 && canEditTracks ? (
                          <Button
                            variant="secondary"
                            disabled={removeMissing.isPending}
                            onClick={() => {
                              void removeMissing.mutateAsync(detail.data.id).catch((error) => {
                                reportError('Could not repair missing playlist tracks', {
                                  source: 'playlists-view',
                                  error,
                                });
                              });
                            }}
                          >
                            Repair missing
                          </Button>
                        ) : null}
                        {detail.data.playlistType === 'FolderSync' ? (
                          <Button
                            variant="secondary"
                            disabled={syncPlaylist.isPending}
                            onClick={() => {
                              void syncPlaylist.mutateAsync(detail.data.id).catch((error) => {
                                reportError('Could not sync the playlist', {
                                  source: 'playlists-view',
                                  error,
                                });
                              });
                            }}
                          >
                            <RefreshCw className="h-4 w-4" />
                            Sync
                          </Button>
                        ) : null}
                        <Button variant="destructive" onClick={() => setDeletePending(true)}>
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </div>
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search this playlist"
                        aria-label="Search this playlist"
                        className="min-w-48 flex-1 rounded-lg border border-current/15 bg-transparent px-3 py-2 text-sm"
                      />
                      {canEditTracks && selectedPlaylistTrackIds.size > 0 ? (
                        <Button
                          variant="secondary"
                          disabled={removeTracks.isPending}
                          onClick={() => removeSelectedTracks([...selectedPlaylistTrackIds])}
                        >
                          <Trash2 className="h-4 w-4" />
                          {removeTracks.isPending
                            ? 'Removing...'
                            : `Remove ${selectedPlaylistTrackIds.size}`}
                        </Button>
                      ) : null}
                    </div>
                    {detail.data.entries.length === 0 ? (
                      <div className="rounded-lg border border-current/10 p-4 text-sm opacity-70">
                        {detail.data.playlistType === 'Smart'
                          ? 'No tracks match the current smart-playlist rules. Edit the rules to broaden the result.'
                          : detail.data.playlistType === 'FolderSync'
                            ? detail.data.syncError
                              ? 'This folder playlist is disconnected. Restore source access, then sync again.'
                              : 'This folder playlist has no supported audio files.'
                            : 'This playlist is empty. Add tracks from the Library track menu.'}
                      </div>
                    ) : visibleEntries.length === 0 ? (
                      <p className="rounded-lg border border-current/10 p-4 text-sm opacity-70">
                        No tracks match “{query}” in this playlist.
                      </p>
                    ) : (
                      <ol
                        ref={playlistTracksListRef}
                        className="space-y-1 outline-none"
                        role="listbox"
                        aria-label="Playlist tracks"
                        aria-multiselectable={canEditTracks || undefined}
                        aria-activedescendant={
                          focusedIndex >= 0 ? 'playlist-track-' + focusedIndex : undefined
                        }
                        tabIndex={0}
                        onKeyDown={handleListKeyDown}
                      >
                        {visibleEntries.map((entry, index) => (
                          <li
                            key={`${entry.trackId}-${entry.position}`}
                            id={'playlist-track-' + index}
                            role="option"
                            aria-selected={
                              canEditTracks && selectedPlaylistTrackIds.has(entry.trackId)
                            }
                            className={
                              'flex items-center justify-between gap-3 border-b border-current/10 py-2 text-sm ' +
                              (index === focusedIndex
                                ? 'bg-primary/10 ring-2 ring-inset ring-primary/60'
                                : '')
                            }
                          >
                            <label className="flex min-w-0 flex-1 items-center gap-3">
                              {canEditTracks ? (
                                <input
                                  type="checkbox"
                                  checked={selectedPlaylistTrackIds.has(entry.trackId)}
                                  onClick={(event) => handleEntryToggle(index, event)}
                                  onChange={() => undefined}
                                  aria-label={'Select ' + (entry.title ?? entry.trackId)}
                                />
                              ) : (
                                <span aria-hidden="true" className="h-4 w-4 shrink-0" />
                              )}
                              <span
                                className={entry.available ? 'truncate' : 'truncate opacity-55'}
                              >
                                {entry.title ?? entry.trackId}
                                <span className="ml-2 opacity-60">{entry.artist ?? ''}</span>
                                {entry.album ? (
                                  <span className="ml-2 opacity-60">{entry.album}</span>
                                ) : null}
                              </span>
                            </label>
                            <span className="flex items-center gap-1">
                              {!entry.available && canEditTracks ? (
                                <>
                                  <span className="mr-2 text-xs text-[var(--state-warning-ink)]">
                                    Unavailable
                                  </span>
                                  <Button
                                    variant="secondary"
                                    disabled={relinkingTrackId === entry.trackId}
                                    onClick={() => void relinkEntry(entry)}
                                  >
                                    {relinkingTrackId === entry.trackId ? 'Relinking…' : 'Relink'}
                                  </Button>
                                </>
                              ) : null}
                              <button
                                aria-label={`Move ${entry.title ?? entry.trackId} up`}
                                onClick={() => void moveEntry(entry.trackId, -1)}
                                disabled={reorderTracks.isPending || entry.position === 0}
                                className={
                                  canEditTracks
                                    ? 'rounded p-1 hover:bg-current/10 disabled:opacity-30'
                                    : 'hidden'
                                }
                              >
                                <ChevronUp className="h-4 w-4" />
                              </button>
                              <button
                                aria-label={`Move ${entry.title ?? entry.trackId} down`}
                                onClick={() => void moveEntry(entry.trackId, 1)}
                                disabled={
                                  reorderTracks.isPending ||
                                  entry.position === detail.data.entries.length - 1
                                }
                                className={
                                  canEditTracks
                                    ? 'rounded p-1 hover:bg-current/10 disabled:opacity-30'
                                    : 'hidden'
                                }
                              >
                                <ChevronDown className="h-4 w-4" />
                              </button>
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                ) : (
                  <p role="alert">Tarab could not load this playlist.</p>
                )}
              </section>
            </div>
          </>
        )}
      </div>

      <PlaylistEditorDialog
        open={createOpen}
        mode="create"
        isSaving={createPlaylist.isPending}
        onClose={() => setCreateOpen(false)}
        onSave={async (payload) => {
          const created = await createPlaylist.mutateAsync(payload);
          setSelectedId(created.id);
          return true;
        }}
      />
      {detail.data ? (
        <PlaylistEditorDialog
          open={editOpen}
          mode="edit"
          isSaving={updatePlaylist.isPending}
          initial={{
            name: detail.data.name,
            playlistType: detail.data.playlistType,
            smartRules: detail.data.smartRules,
            folderPath: detail.data.folderPath,
          }}
          onClose={() => setEditOpen(false)}
          onSave={async (payload) => {
            await updatePlaylist.mutateAsync({
              playlistId: detail.data.id,
              ...payload,
            });
            return true;
          }}
        />
      ) : null}
      {deletePending && detail.data ? (
        <ConfirmDialog
          title="Delete playlist?"
          message={`Delete “${detail.data.name}”? This does not delete its audio files.`}
          confirmLabel="Delete playlist"
          cancelLabel="Cancel"
          variant="danger"
          onCancel={() => setDeletePending(false)}
          onConfirm={async () => {
            try {
              await deletePlaylist.mutateAsync(detail.data.id);
              setSelectedId(null);
              setSelectedTrackIds(new Set());
            } catch (error) {
              reportError('Could not delete the playlist', {
                source: 'playlists-view',
                error,
              });
            }
          }}
        />
      ) : null}
    </main>
  );
}
