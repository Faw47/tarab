import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistDetail, PlaylistEntry, PlaylistSummary } from '../../../types';
import { PlaylistsView, playlistTypeLabel, trackCountLabel } from '../PlaylistsView';

const { startPlaybackMock, state } = vi.hoisted(() => ({
  startPlaybackMock: vi.fn(async () => 1),
  state: { summaries: [] as unknown[], detail: null as unknown },
}));

vi.mock('../../../lib/playback-actions', () => ({ startPlayback: startPlaybackMock }));
vi.mock('../../../features/playlists/queries', () => ({
  usePlaylistsQuery: () => ({ data: state.summaries, isError: false, isLoading: false }),
  usePlaylistDetailQuery: (id: string | null) => ({
    data: id ? state.detail : undefined,
    isLoading: false,
  }),
}));
vi.mock('../../../features/playlists/mutations', () => {
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
  });
  return {
    useCreatePlaylistMutation: mutation,
    useDeletePlaylistMutation: mutation,
    usePinPlaylistMutation: mutation,
    useRelinkPlaylistTrackMutation: mutation,
    useRemoveMissingTracksMutation: mutation,
    useRemoveTracksMutation: mutation,
    useReorderPlaylistTracksMutation: mutation,
    useSyncPlaylistMutation: mutation,
    useUpdatePlaylistMutation: mutation,
  };
});
vi.mock('../PlaylistEditorDialog', () => ({ PlaylistEditorDialog: () => null }));

const entry = (n: number, available = true): PlaylistEntry => ({
  trackId: `t${n}`,
  position: n,
  available,
  title: `Song ${n}`,
  artist: 'Artist',
  filePath: available ? `/music/${n}.flac` : null,
  hasCoverArt: false,
});

function setPlaylist(entries: PlaylistEntry[], playlistType: PlaylistSummary['playlistType']) {
  const summary: PlaylistSummary = {
    id: 'p1',
    name: 'Road trip',
    playlistType,
    trackCount: entries.length,
    missingCount: entries.filter((item) => !item.available).length,
    createdAt: 0,
    updatedAt: 0,
  };
  state.summaries = [summary];
  state.detail = { ...summary, entries } as unknown as PlaylistDetail;
}

describe('PlaylistsView (FE-26)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('labels types and counts in plain words', () => {
    expect(playlistTypeLabel('FolderSync')).toBe('Folder playlist');
    expect(playlistTypeLabel('Smart')).toBe('Smart playlist');
    expect(playlistTypeLabel('Manual')).toBe('Playlist');
    expect(trackCountLabel(1)).toBe('1 track');
    expect(trackCountLabel(2)).toBe('2 tracks');

    setPlaylist([entry(0)], 'FolderSync');
    render(<PlaylistsView />);
    expect(screen.getByRole('button', { name: /Road trip/ })).toHaveTextContent(
      '1 track · Folder playlist',
    );
  });

  it('plays a row in the context of the playlist, skipping unavailable entries', () => {
    setPlaylist([entry(0), entry(1, false), entry(2)], 'Manual');
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /Road trip/ }));

    expect(screen.queryByRole('button', { name: 'Play Song 1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play Song 2' }));
    expect(startPlaybackMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't2' }),
      expect.objectContaining({ queueIndex: 1 }),
    );
    const queue = (startPlaybackMock.mock.calls[0] as unknown[])[1] as { queue: { id: string }[] };
    expect(queue.queue.map((track) => track.id)).toEqual(['t0', 't2']);
    // The details pane is not one big live region any more.
    expect(screen.getByRole('region', { name: 'Playlist details' })).not.toHaveAttribute(
      'aria-live',
    );
  });

  it('virtualizes long playlists', () => {
    setPlaylist(
      Array.from({ length: 2000 }, (_, n) => entry(n)),
      'Manual',
    );
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /Road trip/ }));
    const list = screen.getByRole('list', { name: 'Playlist tracks' });
    expect(within(list).queryAllByRole('checkbox').length).toBeLessThan(200);
  });
});
