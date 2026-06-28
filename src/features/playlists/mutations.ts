import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BackendSmartPlaylistRule, PlaylistType } from '../../types';
import {
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist,
  removeMissingFromPlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistTracks,
  setPlaylistPinned,
  syncPlaylist,
  updatePlaylist,
} from './api';
import { playlistKeys } from './queryKeys';

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
    mutationFn: ({ playlistId, trackIds }: { playlistId: string; trackIds: string[] }) =>
      addTracksToPlaylist(playlistId, trackIds),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.setQueryData(playlistKeys.detail(variables.playlistId), data);
    },
  });
}

export function useRemoveTracksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ playlistId, trackIds }: { playlistId: string; trackIds: string[] }) =>
      removeTracksFromPlaylist(playlistId, trackIds),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.setQueryData(playlistKeys.detail(variables.playlistId), data);
    },
  });
}

export function useReorderPlaylistTracksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ playlistId, trackIds }: { playlistId: string; trackIds: string[] }) =>
      reorderPlaylistTracks(playlistId, trackIds),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.lists() });
      queryClient.setQueryData(playlistKeys.detail(variables.playlistId), data);
    },
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
