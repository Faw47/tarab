import { useQuery } from '@tanstack/react-query';
import { fetchPlaylistDetail, fetchPlaylists } from './api';
import { playlistKeys } from './queryKeys';

export function usePlaylistsQuery() {
  return useQuery({
    queryKey: playlistKeys.lists(),
    queryFn: fetchPlaylists,
  });
}

export function usePlaylistDetailQuery(playlistId: string | null) {
  return useQuery({
    queryKey: playlistId ? playlistKeys.detail(playlistId) : [],
    queryFn: () => {
      if (!playlistId) throw new Error('No playlist ID provided');
      return fetchPlaylistDetail(playlistId);
    },
    enabled: !!playlistId,
  });
}
