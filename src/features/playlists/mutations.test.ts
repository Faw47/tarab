import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addTracksToPlaylist, removeTracksFromPlaylist, reorderPlaylistTracks } from './api';
import {
  useAddTracksMutation,
  useRemoveTracksMutation,
  useReorderPlaylistTracksMutation,
} from './mutations';
import { playlistKeys } from './queryKeys';

vi.mock('./api', () => ({
  addTracksToPlaylist: vi.fn(),
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  relinkPlaylistTrack: vi.fn(),
  removeMissingFromPlaylist: vi.fn(),
  removeTracksFromPlaylist: vi.fn(),
  reorderPlaylistTracks: vi.fn(),
  setPlaylistPinned: vi.fn(),
  syncPlaylist: vi.fn(),
  updatePlaylist: vi.fn(),
}));

function createMutationContext() {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  return { invalidateQueries, queryClient, wrapper };
}

function expectPlaylistQueriesInvalidated(
  invalidateQueries: ReturnType<typeof createMutationContext>['invalidateQueries'],
  playlistId: string,
) {
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: playlistKeys.lists() });
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: playlistKeys.detail(playlistId),
  });
  expect(invalidateQueries).toHaveBeenCalledTimes(2);
}

function seedPlaylistDetailForReplay(queryClient: QueryClient, playlistId: string) {
  const queryKey = playlistKeys.detail(playlistId);
  const existingDetail = { version: 'current' };
  queryClient.setQueryData(queryKey, existingDetail);
  const setQueryData = vi.spyOn(queryClient, 'setQueryData');

  return { existingDetail, queryKey, setQueryData };
}

describe('playlist mutation hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates playlist list and detail when adding tracks succeeds', async () => {
    const replayedDetail = { version: 'historical replay' };
    vi.mocked(addTracksToPlaylist).mockResolvedValue(replayedDetail as never);
    const { invalidateQueries, queryClient, wrapper } = createMutationContext();
    const cachedDetail = seedPlaylistDetailForReplay(queryClient, 'playlist-1');
    const { result } = renderHook(() => useAddTracksMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        playlistId: 'playlist-1',
        trackIds: ['track-1'],
        mutationId: 'mutation-1',
      });
    });

    expectPlaylistQueriesInvalidated(invalidateQueries, 'playlist-1');
    expect(queryClient.getQueryData(cachedDetail.queryKey)).toEqual(cachedDetail.existingDetail);
    expect(cachedDetail.setQueryData).not.toHaveBeenCalled();
  });

  it('invalidates playlist list and detail when adding tracks fails', async () => {
    vi.mocked(addTracksToPlaylist).mockRejectedValue(new Error('add failed'));
    const { invalidateQueries, wrapper } = createMutationContext();
    const { result } = renderHook(() => useAddTracksMutation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          playlistId: 'playlist-1',
          trackIds: ['track-1'],
          mutationId: 'mutation-1',
        }),
      ).rejects.toThrow('add failed');
    });

    expectPlaylistQueriesInvalidated(invalidateQueries, 'playlist-1');
  });

  it('invalidates playlist list and detail when removing tracks succeeds', async () => {
    const replayedDetail = { version: 'historical replay' };
    vi.mocked(removeTracksFromPlaylist).mockResolvedValue(replayedDetail as never);
    const { invalidateQueries, queryClient, wrapper } = createMutationContext();
    const cachedDetail = seedPlaylistDetailForReplay(queryClient, 'playlist-1');
    const { result } = renderHook(() => useRemoveTracksMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        playlistId: 'playlist-1',
        trackIds: ['track-1'],
        mutationId: 'mutation-2',
      });
    });

    expectPlaylistQueriesInvalidated(invalidateQueries, 'playlist-1');
    expect(queryClient.getQueryData(cachedDetail.queryKey)).toEqual(cachedDetail.existingDetail);
    expect(cachedDetail.setQueryData).not.toHaveBeenCalled();
  });

  it('invalidates playlist list and detail when removing tracks fails', async () => {
    vi.mocked(removeTracksFromPlaylist).mockRejectedValue(new Error('remove failed'));
    const { invalidateQueries, wrapper } = createMutationContext();
    const { result } = renderHook(() => useRemoveTracksMutation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          playlistId: 'playlist-1',
          trackIds: ['track-1'],
          mutationId: 'mutation-2',
        }),
      ).rejects.toThrow('remove failed');
    });

    expectPlaylistQueriesInvalidated(invalidateQueries, 'playlist-1');
  });

  it('invalidates playlist list and detail when reordering tracks succeeds', async () => {
    const replayedDetail = { version: 'historical replay' };
    vi.mocked(reorderPlaylistTracks).mockResolvedValue(replayedDetail as never);
    const { invalidateQueries, queryClient, wrapper } = createMutationContext();
    const cachedDetail = seedPlaylistDetailForReplay(queryClient, 'playlist-1');
    const { result } = renderHook(() => useReorderPlaylistTracksMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        playlistId: 'playlist-1',
        trackIds: ['track-2', 'track-1'],
        expectedTrackIds: ['track-1', 'track-2'],
        mutationId: 'mutation-3',
      });
    });

    expectPlaylistQueriesInvalidated(invalidateQueries, 'playlist-1');
    expect(queryClient.getQueryData(cachedDetail.queryKey)).toEqual(cachedDetail.existingDetail);
    expect(cachedDetail.setQueryData).not.toHaveBeenCalled();
  });

  it('invalidates playlist list and detail when reordering tracks fails', async () => {
    vi.mocked(reorderPlaylistTracks).mockRejectedValue(new Error('reorder failed'));
    const { invalidateQueries, wrapper } = createMutationContext();
    const { result } = renderHook(() => useReorderPlaylistTracksMutation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          playlistId: 'playlist-1',
          trackIds: ['track-2', 'track-1'],
          expectedTrackIds: ['track-1', 'track-2'],
          mutationId: 'mutation-3',
        }),
      ).rejects.toThrow('reorder failed');
    });

    expectPlaylistQueriesInvalidated(invalidateQueries, 'playlist-1');
  });
});
