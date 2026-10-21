import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistDetail, PlaylistEntry, PlaylistSummary } from '../../../types';
import { PlaylistsView, playlistTypeLabel, trackCountLabel } from '../PlaylistsView';

const { startPlaybackMock, removeTracksMutation, reorderTracksMock, state } = vi.hoisted(() => ({
  startPlaybackMock: vi.fn(async () => 1),
  removeTracksMutation: vi.fn(
    async (_variables: { playlistId: string; trackIds: string[]; mutationId: string }) => undefined,
  ),
  reorderTracksMock: vi.fn(
    async (_variables: {
      playlistId: string;
      trackIds: string[];
      expectedTrackIds: string[];
      mutationId: string;
    }) => undefined,
  ),
  state: { summaries: [] as unknown[], detail: null as unknown },
}));

vi.mock('../../../lib/playback-actions', () => ({
  PlaybackCoordinator: { start: startPlaybackMock }, startPlayback: startPlaybackMock }));
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
    useRemoveTracksMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: removeTracksMutation,
      isPending: false,
    }),
    useReorderPlaylistTracksMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: reorderTracksMock,
      isPending: false,
    }),
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

  it('does not offer manual reorder controls for smart playlists', () => {
    setPlaylist([entry(0)], 'Smart');
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /Road trip/ }));

    expect(screen.queryByRole('button', { name: 'Move Song 1 up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move Song 1 down' })).toBeNull();
  });

  it('sends the order snapshot used for a manual reorder', () => {
    setPlaylist([entry(0), entry(1)], 'Manual');
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /Road trip/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Move Song 1 up' }));

    expect(reorderTracksMock).toHaveBeenCalledWith({
      playlistId: 'p1',
      expectedTrackIds: ['t0', 't1'],
      trackIds: ['t1', 't0'],
      mutationId: expect.any(String),
    });
  });

  it('virtualizes long playlists', () => {
    // jsdom has no layout; give the scroll container a size so the virtualizer renders a window.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 576,
      top: 0,
      left: 0,
      bottom: 576,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(576);
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    setPlaylist(
      Array.from({ length: 2000 }, (_, n) => entry(n)),
      'Manual',
    );
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /Road trip/ }));
    const list = screen.getByRole('list', { name: 'Playlist tracks' });
    const rendered = within(list).queryAllByRole('checkbox').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(200);
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveAttribute('aria-setsize', '2000');
    expect(items[0]).toHaveAttribute('aria-posinset', '1');
    rect.mockRestore();
    height.mockRestore();
    width.mockRestore();
  });
  it('reuses a unique request ID for each playlist edit action', () => {
    setPlaylist([entry(0), entry(1)], 'Manual');
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /Road trip/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Move Song 1 up' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Song 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 1' }));

    expect(reorderTracksMock).toHaveBeenCalledWith({
      playlistId: 'p1',
      expectedTrackIds: ['t0', 't1'],
      trackIds: ['t1', 't0'],
      mutationId: expect.any(String),
    });
    expect(removeTracksMutation).toHaveBeenCalledWith({
      playlistId: 'p1',
      trackIds: ['t0'],
      mutationId: expect.any(String),
    });

    const reorderId = reorderTracksMock.mock.calls[0]?.[0]?.mutationId;
    const removeId = removeTracksMutation.mock.calls[0]?.[0]?.mutationId;
    expect(reorderId).toEqual(expect.any(String));
    expect(removeId).toEqual(expect.any(String));
    expect(removeId).not.toBe(reorderId);
  });
});
