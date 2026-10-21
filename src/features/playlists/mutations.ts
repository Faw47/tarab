import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BackendSmartPlaylistRule, PlaylistType } from '../../types';
import {
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist,
  relinkPlaylistTrack,
  removeMissingFromPlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistTracks,
  setPlaylistPinned,
  syncPlaylist,
  updatePlaylist,
} from './api';
import { playlistKeys } from './queryKeys';

export function invalidatePlaylistMutationQueries(queryClient: QueryClient, playlistId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: playlistKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) }),
  ]);
}

export function useCreatePlaylistMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      name: string;
      playlistType?: PlaylistType;
      smartRules?: BackendSmartPlaylistRule[];
      folderPath?: string;
    }) =>
      createPlaylist(
        variables.name,
        variables.playlistType,
        variables.smartRules,
        variables.folderPath,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
    },
  });
}

export function useUpdatePlaylistMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updatePlaylist,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.setQueryData(playlistKeys.detail(variables.playlistId), data);
    },
  });
}

export function useDeletePlaylistMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePlaylist,
    onSuccess: (_, playlistId) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.removeQueries({ queryKey: playlistKeys.detail(playlistId) });
    },
  });
}

export function usePinPlaylistMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ playlistId, isPinned }: { playlistId: string; isPinned: boolean }) =>
      setPlaylistPinned(playlistId, isPinned),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.setQueryData(playlistKeys.detail(variables.playlistId), data);
    },
  });
}

export function useAddTracksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      playlistId,
      trackIds,
      mutationId,
    }: {
      playlistId: string;
      trackIds: string[];
      mutationId: string;
    }) => addTracksToPlaylist(playlistId, trackIds, mutationId),
    onSuccess: (_data, variables) =>
      invalidatePlaylistMutationQueries(queryClient, variables.playlistId),
    onError: (_error, variables) =>
      invalidatePlaylistMutationQueries(queryClient, variables.playlistId),
  });
}

export function useRemoveTracksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      playlistId,
      trackIds,
      mutationId,
    }: {
      playlistId: string;
      trackIds: string[];
      mutationId: string;
    }) => removeTracksFromPlaylist(playlistId, trackIds, mutationId),
    onSuccess: (_data, variables) =>
      invalidatePlaylistMutationQueries(queryClient, variables.playlistId),
    onError: (_error, variables) =>
      invalidatePlaylistMutationQueries(queryClient, variables.playlistId),
  });
}

export function useRelinkPlaylistTrackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      playlistId,
      oldTrackId,
      newTrackId,
    }: {
      playlistId: string;
      oldTrackId: string;
      newTrackId: string;
    }) => relinkPlaylistTrack(playlistId, oldTrackId, newTrackId),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.setQueryData(playlistKeys.detail(variables.playlistId), data);
    },
  });
}

export function useReorderPlaylistTracksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      playlistId,
      trackIds,
      expectedTrackIds,
      mutationId,
    }: {
      playlistId: string;
      trackIds: string[];
      expectedTrackIds: string[];
      mutationId: string;
    }) => reorderPlaylistTracks(playlistId, trackIds, expectedTrackIds, mutationId),
    onSuccess: (_data, variables) =>
      invalidatePlaylistMutationQueries(queryClient, variables.playlistId),
    onError: (_error, variables) =>
      invalidatePlaylistMutationQueries(queryClient, variables.playlistId),
  });
}

export function useSyncPlaylistMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncPlaylist,
    onSuccess: (data, playlistId) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.setQueryData(playlistKeys.detail(playlistId), data);
    },
  });
}

export function useRemoveMissingTracksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeMissingFromPlaylist,
    onSuccess: (data, playlistId) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.setQueryData(playlistKeys.detail(playlistId), data);
    },
  });
}
