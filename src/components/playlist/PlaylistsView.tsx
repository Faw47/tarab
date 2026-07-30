import {
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
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { PlaylistEditorDialog } from './PlaylistEditorDialog';

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
  const [query, setQuery] = useState('');
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
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

  const moveEntry = async (trackId: string, direction: -1 | 1) => {
    if (!detail.data) return;
    const ids = detail.data.entries.map((entry) => entry.trackId);
    const from = ids.indexOf(trackId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await reorderTracks.mutateAsync({ playlistId: detail.data.id, trackIds: ids });
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
          <section className="rounded-xl border border-red-500/40 p-5" role="alert">
            <TriangleAlert className="mb-2 h-5 w-5 text-red-400" />
            <p>Tarab could not load playlists.</p>
            <Button className="mt-3" onClick={() => void playlists.refetch()}>
              Retry
            </Button>
          </section>
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
                        ? 'border-black bg-white text-black shadow-[4px_4px_0_0_#000]'
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
                        <h2 className="text-xl font-black">{detail.data.name}</h2>
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
                          <p className="mt-2 text-sm text-red-400">{detail.data.syncError}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={playableTracks.length === 0}
                          onClick={() => {
                            const first = playableTracks[0];
                            if (first) {
                              void startPlayback(first, {
                                queue: playableTracks,
                                queueIndex: 0,
                              });
                            }
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
                          onClick={() =>
                            pinPlaylist.mutate({
                              playlistId: detail.data.id,
                              isPinned: !detail.data.isPinned,
                            })
                          }
                        >
                          {detail.data.isPinned ? (
                            <PinOff className="h-4 w-4" />
                          ) : (
                            <Pin className="h-4 w-4" />
                          )}
                          {detail.data.isPinned ? 'Unpin' : 'Pin'}
                        </Button>
                        {detail.data.missingCount > 0 ? (
                          <Button
                            variant="secondary"
                            onClick={() => removeMissing.mutate(detail.data.id)}
                          >
                            Repair missing
                          </Button>
                        ) : null}
                        {detail.data.playlistType === 'FolderSync' ? (
                          <Button
                            variant="secondary"
                            disabled={syncPlaylist.isPending}
                            onClick={() => syncPlaylist.mutate(detail.data.id)}
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
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search this playlist"
                        aria-label="Search this playlist"
                        className="min-w-48 flex-1 rounded-lg border border-current/15 bg-transparent px-3 py-2 text-sm"
                      />
                      {selectedTrackIds.size > 0 ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (!detail.data) return;
                            void removeTracks
                              .mutateAsync({
                                playlistId: detail.data.id,
                                trackIds: [...selectedTrackIds],
                              })
                              .then(() => setSelectedTrackIds(new Set()));
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove {selectedTrackIds.size}
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
                      <ol className="space-y-1">
                        {visibleEntries.map((entry) => (
                          <li
                            key={`${entry.trackId}-${entry.position}`}
                            className="flex items-center justify-between gap-3 border-b border-current/10 py-2 text-sm"
                          >
                            <label className="flex min-w-0 flex-1 items-center gap-3">
                              <input
                                type="checkbox"
                                checked={selectedTrackIds.has(entry.trackId)}
                                onChange={(event) => {
                                  setSelectedTrackIds((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(entry.trackId);
                                    else next.delete(entry.trackId);
                                    return next;
                                  });
                                }}
                                aria-label={`Select ${entry.title ?? entry.trackId}`}
                              />
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
                              {!entry.available ? (
                                <>
                                  <span className="mr-2 text-xs text-amber-400">Unavailable</span>
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
                                disabled={entry.position === 0}
                                className="rounded p-1 hover:bg-current/10 disabled:opacity-30"
                              >
                                <ChevronUp className="h-4 w-4" />
                              </button>
                              <button
                                aria-label={`Move ${entry.title ?? entry.trackId} down`}
                                onClick={() => void moveEntry(entry.trackId, 1)}
                                disabled={entry.position === detail.data.entries.length - 1}
                                className="rounded p-1 hover:bg-current/10 disabled:opacity-30"
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
