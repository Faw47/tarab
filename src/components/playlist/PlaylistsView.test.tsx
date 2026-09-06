import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  usePlaylistsQuery: vi.fn(),
  usePlaylistDetailQuery: vi.fn(),
  useCreatePlaylistMutation: vi.fn(),
  useDeletePlaylistMutation: vi.fn(),
  usePinPlaylistMutation: vi.fn(),
  useRelinkPlaylistTrackMutation: vi.fn(),
  useRemoveMissingTracksMutation: vi.fn(),
  useRemoveTracksMutation: vi.fn(),
  useReorderPlaylistTracksMutation: vi.fn(),
  useSyncPlaylistMutation: vi.fn(),
  useUpdatePlaylistMutation: vi.fn(),
  reportError: vi.fn(),
  startPlayback: vi.fn(),
}));

vi.mock('../../features/playlists/queries', () => ({
  usePlaylistsQuery: mocks.usePlaylistsQuery,
  usePlaylistDetailQuery: mocks.usePlaylistDetailQuery,
}));

vi.mock('../../features/playlists/mutations', () => ({
  useCreatePlaylistMutation: mocks.useCreatePlaylistMutation,
  useDeletePlaylistMutation: mocks.useDeletePlaylistMutation,
  usePinPlaylistMutation: mocks.usePinPlaylistMutation,
  useRelinkPlaylistTrackMutation: mocks.useRelinkPlaylistTrackMutation,
  useRemoveMissingTracksMutation: mocks.useRemoveMissingTracksMutation,
  useRemoveTracksMutation: mocks.useRemoveTracksMutation,
  useReorderPlaylistTracksMutation: mocks.useReorderPlaylistTracksMutation,
  useSyncPlaylistMutation: mocks.useSyncPlaylistMutation,
  useUpdatePlaylistMutation: mocks.useUpdatePlaylistMutation,
}));

vi.mock('../../store/settings-store', () => ({
  useSettingsStore: (selector: (state: { theme: string }) => unknown) =>
    selector({ theme: 'dark' }),
}));

vi.mock('../../lib/playback-actions', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('../../lib/report-error', () => ({ reportError: mocks.reportError }));
vi.mock('../../lib/track-refresh', () => ({ refreshTracksByFilePaths: vi.fn() }));
vi.mock('../../platform/dialog', () => ({
  dialog: { openAudioFiles: vi.fn(async () => null) },
}));

vi.mock('../ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock('../ui/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('./PlaylistEditorDialog', () => ({
  PlaylistEditorDialog: () => null,
}));

vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

import { PlaylistsView } from './PlaylistsView';

const playlistOne = {
  id: 'one',
  name: 'One',
  isPinned: false,
  updatedAt: 1,
  playlistType: 'Manual' as const,
  trackCount: 1,
  missingCount: 0,
};

const playlistTwo = {
  id: 'two',
  name: 'Two',
  isPinned: false,
  updatedAt: 2,
  playlistType: 'Manual' as const,
  trackCount: 1,
  missingCount: 0,
};

const detailOne = {
  ...playlistOne,
  entries: [
    {
      trackId: 'track-one',
      position: 0,
      title: 'First Song',
      artist: 'Artist',
      album: 'Album',
      duration: 180,
      available: true,
      filePath: '/music/one.mp3',
      hasCoverArt: false,
      coverArtHash: null,
    },
  ],
  folderPath: null,
  lastSyncedAt: null,
  syncError: null,
  smartRules: [],
};

const detailTwo = {
  ...playlistTwo,
  entries: [
    {
      trackId: 'track-two',
      position: 0,
      title: 'Second Song',
      artist: 'Artist',
      album: 'Album',
      duration: 180,
      available: true,
      filePath: '/music/two.mp3',
      hasCoverArt: false,
      coverArtHash: null,
    },
  ],
  folderPath: null,
  lastSyncedAt: null,
  syncError: null,
  smartRules: [],
};

describe('PlaylistsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePlaylistsQuery.mockReturnValue({
      data: [playlistOne, playlistTwo],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.usePlaylistDetailQuery.mockImplementation((playlistId: string | null) => ({
      data: playlistId === 'one' ? detailOne : playlistId === 'two' ? detailTwo : undefined,
      isLoading: false,
    }));

    for (const mutation of [
      mocks.useCreatePlaylistMutation,
      mocks.useDeletePlaylistMutation,
      mocks.usePinPlaylistMutation,
      mocks.useRelinkPlaylistTrackMutation,
      mocks.useRemoveMissingTracksMutation,
      mocks.useRemoveTracksMutation,
      mocks.useReorderPlaylistTracksMutation,
      mocks.useSyncPlaylistMutation,
      mocks.useUpdatePlaylistMutation,
    ]) {
      mutation.mockReturnValue({
        isPending: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
      });
    }
  });

  it('reports playlist playback failures instead of leaving a rejected promise', async () => {
    const error = new Error('decoder unavailable');
    mocks.startPlayback.mockRejectedValueOnce(error);
    render(<PlaylistsView />);

    fireEvent.click(screen.getByRole('button', { name: /^One/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Play$/ }));

    await waitFor(() =>
      expect(mocks.reportError).toHaveBeenCalledWith('Failed to play playlist', {
        source: 'playlists-view',
        error,
      }),
    );
  });
  it('clears playlist-local search and selected tracks when switching playlists', () => {
    render(<PlaylistsView />);

    fireEvent.click(screen.getByRole('button', { name: /^One/ }));
    fireEvent.change(screen.getByPlaceholderText('Search this playlist'), {
      target: { value: 'First' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First Song' }));

    expect(screen.getByRole('button', { name: 'Remove 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Two/ }));

    expect(screen.getByPlaceholderText('Search this playlist')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Second Song' })).not.toBeChecked();
  });
  it('supports keyboard focus, range selection, playback, and deletion in playlist detail', async () => {
    const entries = [
      detailOne.entries[0],
      {
        ...detailOne.entries[0],
        trackId: 'track-two',
        title: 'Second Song',
        filePath: '/music/two.mp3',
        position: 1,
      },
      {
        ...detailOne.entries[0],
        trackId: 'track-three',
        title: 'Third Song',
        filePath: '/music/three.mp3',
        position: 2,
      },
    ];
    mocks.usePlaylistDetailQuery.mockReturnValue({
      data: { ...detailOne, entries, trackCount: entries.length },
      isLoading: false,
    });
    const removeMutation = vi.fn().mockResolvedValue({});
    mocks.useRemoveTracksMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: removeMutation,
    });
    mocks.startPlayback.mockResolvedValue(undefined);

    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /^One/ }));

    const list = screen.getByRole('listbox', { name: 'Playlist tracks' });
    list.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowUp', shiftKey: true });

    expect(list).toHaveAttribute('aria-activedescendant', 'playlist-track-0');
    expect(screen.getByRole('checkbox', { name: 'Select First Song' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Second Song' })).toBeChecked();

    fireEvent.keyDown(list, { key: 'a', ctrlKey: true });
    expect(screen.getByRole('checkbox', { name: 'Select Third Song' })).toBeChecked();

    fireEvent.keyDown(list, { key: 'Delete' });
    await waitFor(() =>
      expect(removeMutation).toHaveBeenCalledWith({
        playlistId: 'one',
        trackIds: ['track-one', 'track-two', 'track-three'],
      }),
    );

    fireEvent.keyDown(list, { key: 'Enter' });
    await waitFor(() => expect(mocks.startPlayback).toHaveBeenCalled());
  });
  it('renames a playlist inline through the existing update mutation', async () => {
    const updateMutation = vi.fn().mockResolvedValue(detailOne);
    mocks.useUpdatePlaylistMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: updateMutation,
    });

    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /^One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename playlist' }));

    const input = screen.getByRole('textbox', { name: 'Rename playlist' });
    fireEvent.change(input, { target: { value: 'Night Routes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save playlist name' }));

    await waitFor(() =>
      expect(updateMutation).toHaveBeenCalledWith({
        playlistId: 'one',
        name: 'Night Routes',
      }),
    );
    expect(
      screen.queryByRole('button', { name: 'Cancel playlist rename' }),
    ).not.toBeInTheDocument();
  });

  it('cancels an inline playlist rename with Escape without mutating', () => {
    const updateMutation = vi.fn();
    mocks.useUpdatePlaylistMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: updateMutation,
    });

    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /^One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename playlist' }));

    const input = screen.getByRole('textbox', { name: 'Rename playlist' });
    fireEvent.change(input, { target: { value: 'Discarded name' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(updateMutation).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'One' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save playlist name' })).not.toBeInTheDocument();
  });

  it('keeps the inline rename editor open when the update fails', async () => {
    const error = new Error('rename unavailable');
    const updateMutation = vi.fn().mockRejectedValue(error);
    mocks.useUpdatePlaylistMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: updateMutation,
    });

    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole('button', { name: /^One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename playlist' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rename playlist' }), {
      target: { value: 'Failed name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save playlist name' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not rename the playlist.'),
    );
    expect(updateMutation).toHaveBeenCalledTimes(1);
    expect(mocks.reportError).toHaveBeenCalledWith('Could not rename the playlist', {
      source: 'playlists-view',
      error,
    });
    expect(screen.getByRole('button', { name: 'Cancel playlist rename' })).toBeInTheDocument();
  });
});
