import {
  addTracksToPlaylist as tauriAddTracksToPlaylist,
  createPlaylist as tauriCreatePlaylist,
  deletePlaylist as tauriDeletePlaylist,
  getPlaylistDetail as tauriGetPlaylistDetail,
  getPlaylists as tauriGetPlaylists,
  removeMissingFromPlaylist as tauriRemoveMissingFromPlaylist,
  removeTracksFromPlaylist as tauriRemoveTracksFromPlaylist,
  reorderPlaylistTracks as tauriReorderPlaylistTracks,
  setPlaylistPinned as tauriSetPlaylistPinned,
  syncPlaylist as tauriSyncPlaylist,
  updatePlaylist as tauriUpdatePlaylist,
} from '../../lib/tauri-commands';
import {
  PlaylistDetailSchema,
  PlaylistMutationResultSchema,
  PlaylistSummaryArraySchema,
} from '../../lib/validation/playlist';
import type { BackendSmartPlaylistRule, PlaylistType } from '../../types';

export async function fetchPlaylists() {
  const raw = await tauriGetPlaylists();
  return PlaylistSummaryArraySchema.parse(raw);
}

export async function fetchPlaylistDetail(playlistId: string) {
  const raw = await tauriGetPlaylistDetail(playlistId);
  return PlaylistDetailSchema.parse(raw);
}

export async function createPlaylist(
  name: string,
  playlistType: PlaylistType = 'Manual',
  smartRules?: BackendSmartPlaylistRule[],
  folderPath?: string,
) {
  const raw = await tauriCreatePlaylist(name, playlistType, smartRules, folderPath);
  return PlaylistMutationResultSchema.parse(raw);
}

export async function updatePlaylist(payload: {
  playlistId: string;
  name?: string;
  smartRules?: BackendSmartPlaylistRule[];
  folderPath?: string;
}) {
  const raw = await tauriUpdatePlaylist(
    payload.playlistId,
    payload.name,
    undefined, // trackIds not passed in this overload
    payload.smartRules,
    payload.folderPath,
  );
  return PlaylistMutationResultSchema.parse(raw);
}

export async function deletePlaylist(playlistId: string) {
  await tauriDeletePlaylist(playlistId);
}

export async function setPlaylistPinned(playlistId: string, isPinned: boolean) {
  const raw = await tauriSetPlaylistPinned(playlistId, isPinned);
  return PlaylistMutationResultSchema.parse(raw);
}

export async function addTracksToPlaylist(playlistId: string, trackIds: string[]) {
  const raw = await tauriAddTracksToPlaylist(playlistId, trackIds);
  return PlaylistMutationResultSchema.parse(raw);
}

export async function removeTracksFromPlaylist(playlistId: string, trackIds: string[]) {
  const raw = await tauriRemoveTracksFromPlaylist(playlistId, trackIds);
  return PlaylistMutationResultSchema.parse(raw);
}

export async function reorderPlaylistTracks(playlistId: string, trackIds: string[]) {
  const raw = await tauriReorderPlaylistTracks(playlistId, trackIds);
  return PlaylistMutationResultSchema.parse(raw);
}

export async function syncPlaylist(playlistId: string) {
  const raw = await tauriSyncPlaylist(playlistId);
  return PlaylistMutationResultSchema.parse(raw);
}

export async function removeMissingFromPlaylist(playlistId: string) {
  const raw = await tauriRemoveMissingFromPlaylist(playlistId);
  return PlaylistMutationResultSchema.parse(raw);
}
