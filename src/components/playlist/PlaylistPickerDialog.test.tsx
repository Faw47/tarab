import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedQueries = vi.hoisted(() => ({
  usePlaylistsQuery: vi.fn(),
}));

const mockedMutations = vi.hoisted(() => ({
  useAddTracksMutation: vi.fn(),
  useCreatePlaylistMutation: vi.fn(),
}));

vi.mock('../../features/playlists/queries', () => ({
  usePlaylistsQuery: mockedQueries.usePlaylistsQuery,
}));

vi.mock('../../features/playlists/mutations', () => ({
  useAddTracksMutation: mockedMutations.useAddTracksMutation,
  useCreatePlaylistMutation: mockedMutations.useCreatePlaylistMutation,
}));

vi.mock('../../store/playlist-store', () => ({
  usePlaylistStore: vi.fn((selector) => selector({ selectedPlaylistId: null })),
}));

vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));

import { PlaylistPickerDialog } from './PlaylistPickerDialog';

const makePlaylist = (id: string, name: string) => ({
  id,
  name,
  playlistType: 'Manual' as const,
  trackCount: 0,
  missingCount: 0,
  createdAt: 1,
  updatedAt: 1,
  lastSyncedAt: null,
  syncError: null,
});

describe('PlaylistPickerDialog', () => {
  const mockAddTracks = vi.fn().mockResolvedValue(undefined);
  const mockCreatePlaylist = vi.fn().mockResolvedValue(makePlaylist('pl_new', 'Late Night'));

  beforeEach(() => {
    vi.clearAllMocks();

    mockedQueries.usePlaylistsQuery.mockReturnValue({
      data: [makePlaylist('pl_chill', 'Chill Nights'), makePlaylist('pl_road', 'Road Trip')],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    mockedMutations.useAddTracksMutation.mockReturnValue({
      mutateAsync: mockAddTracks,
      isPending: false,
    });

    mockedMutations.useCreatePlaylistMutation.mockReturnValue({
      mutateAsync: mockCreatePlaylist,
      isPending: false,
    });
  });

  it('does not load playlists while the picker is closed', () => {
    render(<PlaylistPickerDialog open={false} trackIds={['t1']} onClose={vi.fn()} />);

    expect(mockedQueries.usePlaylistsQuery).toHaveBeenCalledWith(false);
  });

  it('resets its transient state after closing and reopening', async () => {
    const view = render(<PlaylistPickerDialog open trackIds={['t1']} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Search playlists'), {
      target: { value: 'road' },
    });
    expect(screen.queryByText('Chill Nights')).not.toBeInTheDocument();

    view.rerender(<PlaylistPickerDialog open={false} trackIds={['t1']} onClose={vi.fn()} />);
    view.rerender(<PlaylistPickerDialog open trackIds={['t1']} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search playlists')).toHaveValue('');
      expect(screen.getByText('Chill Nights')).toBeInTheDocument();
    });
  });

  it('filters playlists by search query', () => {
    render(<PlaylistPickerDialog open trackIds={['t1']} onClose={vi.fn()} />);

    expect(screen.getByText('Chill Nights')).toBeInTheDocument();
    expect(screen.getByText('Road Trip')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search playlists'), {
      target: { value: 'road' },
    });

    expect(screen.queryByText('Chill Nights')).not.toBeInTheDocument();
    expect(screen.getByText('Road Trip')).toBeInTheDocument();
  });

  it('adds selected tracks to the chosen playlist and closes', async () => {
    const onClose = vi.fn();
    render(<PlaylistPickerDialog open trackIds={['t1', 't2']} onClose={onClose} />);

    const roadButton = screen.getByText('Road Trip').closest('button');
    expect(roadButton).toBeTruthy();
    fireEvent.click(roadButton!);

    await waitFor(() => {
      expect(mockAddTracks).toHaveBeenCalledWith({ playlistId: 'pl_road', trackIds: ['t1', 't2'] });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('supports quick-create from picker and refreshes playlists', async () => {
    render(<PlaylistPickerDialog open trackIds={['t1']} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    fireEvent.change(screen.getByPlaceholderText('My playlist'), {
      target: { value: 'Late Night' },
    });

    const createBtn = screen.getByRole('button', { name: /^Create$/i });
    await waitFor(() => expect(createBtn).not.toBeDisabled());
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockCreatePlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Late Night',
          playlistType: 'Manual',
        }),
      );
      expect(mockAddTracks).toHaveBeenCalledWith({ playlistId: 'pl_new', trackIds: ['t1'] });
    });
  });
});
