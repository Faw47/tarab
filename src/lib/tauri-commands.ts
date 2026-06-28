import { invoke as originalInvoke } from '@tauri-apps/api/core';
import { ipcBatchLimit } from './ipc-concurrency';
import { Perf } from './performance';

const invoke = <T>(cmd: string, args?: unknown): Promise<T> => {
  return Perf.measureIPC(cmd, args, originalInvoke);
};

import type {
  BackendSmartPlaylistRule,
  DesktopMediaSessionSyncPayload,
  DesktopNativeUiState,
  Playlist,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistType,
  TagInfo,
  TagUpdate,
  TrackMetadata,
} from '../types';

// Audio playback commands
export const playTrack = async (filePath: string, startPos?: number): Promise<void> => {
  return invoke('play_track', { filePath, startPos });
};

export const crossfadeToTrack = async (
  filePath: string,
  durationSecs: number,
  startPos?: number,
): Promise<void> => {
  return invoke('crossfade_to_track', { filePath, startPos, durationSecs });
};

/** Queue-decoded next file on the current Sink for gapless playback (no crossfade). */
export const preloadNextTrack = async (filePath: string | null): Promise<void> => {
  return invoke('preload_next_track', { filePath });
};

export const pausePlayback = async (): Promise<void> => {
  return invoke('pause_playback');
};

export const resumePlayback = async (): Promise<void> => {
  return invoke('resume_playback');
};

export const stopPlayback = async (): Promise<void> => {
  return invoke('stop_playback');
};

export const seekPlayback = async (positionSecs: number): Promise<void> => {
  return invoke('seek_playback', { positionSecs });
};

export const getPlaybackPosition = async (): Promise<number> => {
  return invoke('get_playback_position');
};

export const getDuration = async (): Promise<number> => {
  return invoke('get_duration');
};

export const setVolume = async (volume: number): Promise<void> => {
  return invoke('set_volume', { volume });
};

export const setVolumeRamp = async (
  from: number,
  to: number,
  durationMs: number,
): Promise<void> => {
  return invoke('set_volume_ramp', {
    from,
    to,
    durationMs: Math.max(0, Math.round(durationMs)),
  });
};

export const setPlaybackSpeed = async (speed: number): Promise<void> => {
  return invoke('set_playback_speed', { speed });
};

export const setCrossfadeDuration = async (seconds: number): Promise<void> => {
  return invoke('set_crossfade_duration', { seconds });
};

export const setAudioBooster = async (level: number): Promise<void> => {
  return invoke('set_audio_booster', { level });
};

// Playback session persistence
export interface PlaybackSessionPayload {
  version: number;
  currentTrackId: string | null;
  queueIds: string[];
  queueIndex: number;
  currentTime: number;
  playbackSpeed: number;
  volume: number;
  wasPlaying: boolean;
  shuffleEnabled: boolean;
  loopMode: string;
  stopAfterCurrent: boolean;
  lastView?: string;
  lastOpenedAlbum: string | null;
  lastOpenedArtist: string | null;
  lastOpenedAlbumKey?: string | null;
  timestamp: number;
}

export const loadPlaybackSession = async (): Promise<PlaybackSessionPayload | null> => {
  return invoke('load_playback_session');
};

export const savePlaybackSession = async (session: PlaybackSessionPayload): Promise<void> => {
  return invoke('save_playback_session', { session });
};

export interface AudioOutputDeviceInfo {
  id: string;
  name: string;
}

export const listAudioOutputDevices = (): Promise<AudioOutputDeviceInfo[]> => {
  return invoke('list_audio_output_devices');
};

export const setAudioOutputDevice = (deviceId: string): Promise<void> => {
  return invoke('set_audio_output_device', { deviceId });
};

// File operations
export const renameFile = async (oldPath: string, newName: string): Promise<string> => {
  return invoke('rename_file', { oldPath, newName });
};

export const moveFile = async (oldPath: string, newPath: string): Promise<string> => {
  return invoke('move_file', { oldPath, newPath });
};

export const deleteFiles = async (filePaths: string[]): Promise<number> => {
  return invoke('delete_files', { filePaths });
};

export const revealInFileManager = async (path: string): Promise<void> => {
  return invoke('reveal_in_file_manager', { path });
};

export const setLibraryRoots = async (roots: string[]): Promise<void> => {
  return invoke('set_library_roots', { roots });
};

// Library commands
export const scanLibrary = async (folderPath: string, followLinks?: boolean): Promise<string[]> => {
  return invoke('scan_library', { folderPath, followLinks });
};

export const scanLibraryParallel = async (
  folderPath: string,
  followLinks?: boolean,
): Promise<string[]> => {
  return invoke('scan_library_parallel', { folderPath, followLinks });
};

export const getTrackMetadata = async (filePath: string): Promise<TrackMetadata> => {
  return invoke('get_track_metadata', { filePath });
};

export const getCoverArt = async (filePath: string): Promise<string | null> => {
  return invoke('get_cover_art', { filePath });
};

export interface CoverArtPalette {
  primary: string;
  secondary: string;
}

export const getCoverArtPalette = async (filePath: string): Promise<CoverArtPalette | null> => {
  return invoke('get_cover_art_palette', { filePath });
};

export const getCoverArtData = async (filePath: string): Promise<[string, string] | null> => {
  return invoke('get_cover_art_data', { filePath });
};

// Batch metadata loading - much faster for large libraries
export interface BatchTrackMetadata {
  title: string;
  artist: string;
  album_artist?: string | null;
  album: string;
  year: number | null;
  duration_secs: number;
  file_path: string;
  has_cover_art: boolean;
  cover_art_hash: string | null;
  blurhash: string | null;
  file_format: string;
  bitrate: number | null;
  sample_rate: number | null;
  file_size: number | null;
}

export interface BatchTrackMetadataWithArt {
  title: string;
  artist: string;
  album_artist?: string | null;
  album: string;
  year: number | null;
  duration_secs: number;
  file_path: string;
  cover_art: string | null;
  blurhash: string | null;
  file_format: string;
  bitrate: number | null;
  sample_rate: number | null;
  file_size: number | null;
}

export const getBatchMetadata = async (filePaths: string[]): Promise<BatchTrackMetadata[]> => {
  return ipcBatchLimit(() => invoke('get_batch_metadata', { filePaths }));
};

export const getBatchMetadataWithArt = async (
  filePaths: string[],
): Promise<BatchTrackMetadataWithArt[]> => {
  return ipcBatchLimit(() => invoke('get_batch_metadata_with_art', { filePaths }));
};

export const getBatchCoverArt = async (filePaths: string[]): Promise<[string, string | null][]> => {
  return ipcBatchLimit(() => invoke('get_batch_cover_art', { filePaths }));
};

export const generateCoverArtHashes = async (
  filePaths: string[],
): Promise<[string, string | null][]> => {
  return ipcBatchLimit(async () => {
    const result: [string, [string, string | null] | null][] = await invoke(
      'generate_cover_art_hashes',
      { filePaths },
    );
    return result.map(([path, data]) => [path, data ? data[0] : null]);
  });
};

export const getSmartShuffleQueue = async (trackIds: string[]): Promise<string[]> => {
  return invoke('get_smart_shuffle_queue', { trackIds });
};

// Lyrics commands
export const getLyricsForTrack = async (
  trackPath: string,
  autoLyrics: boolean,
  artist: string,
  title: string,
  album: string,
  duration: number,
): Promise<string | null> => {
  return invoke('get_lyrics_for_track', {
    trackPath,
    autoLyrics,
    artist,
    title,
    album,
    duration,
  });
};

export const fetchLrclibLyrics = async (
  filePath: string,
  artist: string,
  title: string,
  album: string,
  duration: number,
): Promise<string | null> => {
  return invoke('fetch_lrclib_lyrics', {
    filePath,
    artist,
    title,
    album,
    duration,
  });
};

export const writeLyricsForTrack = async (trackPath: string, content: string): Promise<void> => {
  return invoke('write_lyrics_for_track', { trackPath, content });
};

export const syncLyricsIndex = async (): Promise<number> => {
  return invoke('sync_lyrics_index');
};

import { dialog } from '../platform/dialog';

// File dialogs
export const selectFolder = async (): Promise<string | null> => {
  return dialog.openFolder();
};

export const selectImageFile = async (): Promise<string | null> => {
  const selected = await dialog.openImageFiles('Select Cover Art', false);
  return selected ? selected[0] : null;
};

export const readImageAsBase64 = async (filePath: string): Promise<[string, string]> => {
  return invoke('read_image_as_base64', { filePath });
};

// Playlist commands
export const getPlaylists = async (): Promise<PlaylistSummary[]> => {
  return invoke('get_playlists');
};

export const getPlaylistDetail = async (playlistId: string): Promise<PlaylistDetail> => {
  return invoke('get_playlist_detail', { playlistId });
};

export const getAllPlaylists = async (): Promise<Playlist[]> => {
  return invoke('get_all_playlists');
};

export const createPlaylist = async (
  name: string,
  playlistType: PlaylistType,
  smartRules?: BackendSmartPlaylistRule[],
  folderPath?: string,
): Promise<Playlist> => {
  return invoke('create_playlist', { name, playlistType, smartRules, folderPath });
};

export const updatePlaylist = async (
  playlistId: string,
  name?: string,
  trackIds?: string[],
  smartRules?: BackendSmartPlaylistRule[],
  folderPath?: string,
): Promise<Playlist> => {
  return invoke('update_playlist', { playlistId, name, trackIds, smartRules, folderPath });
};

export const setPlaylistPinned = async (
  playlistId: string,
  isPinned: boolean,
): Promise<PlaylistDetail> => {
  return invoke('set_playlist_pinned', { playlistId, isPinned });
};

export const deletePlaylist = async (playlistId: string): Promise<void> => {
  return invoke('delete_playlist', { playlistId });
};

export const addTracksToPlaylist = async (
  playlistId: string,
  trackIds: string[],
): Promise<Playlist> => {
  return invoke('add_tracks_to_playlist', { playlistId, trackIds });
};

export const removeTracksFromPlaylist = async (
  playlistId: string,
  trackIds: string[],
): Promise<Playlist> => {
  return invoke('remove_tracks_from_playlist', { playlistId, trackIds });
};

export const reorderPlaylistTracks = async (
  playlistId: string,
  trackIds: string[],
): Promise<Playlist> => {
  return invoke('reorder_playlist_tracks', { playlistId, trackIds });
};

export const syncPlaylist = async (playlistId: string): Promise<PlaylistDetail> => {
  return invoke('sync_playlist', { playlistId });
};

export const removeMissingFromPlaylist = async (playlistId: string): Promise<PlaylistDetail> => {
  return invoke('remove_missing_from_playlist', { playlistId });
};

export const resetPlaylistsData = async (): Promise<void> => {
  return invoke('reset_playlists_data');
};

export const getPlaylistsDataPath = async (): Promise<string> => {
  return invoke('get_playlists_data_path');
};

export const syncFolderPlaylist = async (folderPath: string): Promise<string[]> => {
  return invoke('sync_folder_playlist', { folderPath });
};

// Tag editor commands
export const readFullTags = async (filePath: string): Promise<TagInfo> => {
  return invoke('read_full_tags', { filePath });
};

export const writeTags = async (filePath: string, updates: TagUpdate): Promise<void> => {
  return invoke('write_tags', { filePath, updates });
};

export const writeTagsBatch = async (
  filePaths: string[],
  updates: TagUpdate,
): Promise<string[]> => {
  return invoke('write_tags_batch', { filePaths, updates });
};

export const removeCoverArt = async (filePath: string): Promise<void> => {
  return invoke('remove_cover_art', { filePath });
};

// ========== Database Commands ==========

export interface DbTrack {
  id: string;
  title: string;
  artist: string;
  albumArtist?: string | null;
  album: string;
  year: number | null;
  duration: number;
  filePath: string;
  hasCoverArt: boolean;
  coverArtHash: string | null;
  dateAdded: number;
  playCount: number;
  lastPlayed: number | null;
  rating: number | null;
  blurhash: string | null;
}

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  filePath: string;
  coverArtHash: string | null;
}

export interface LyricsSearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  filePath: string;
  coverArtHash: string | null;
  matchedLine: string;
  matchedLineIndex: number;
}

export interface LibraryStats {
  trackCount: number;
  totalDuration: number;
  artistCount: number;
  albumCount: number;
  totalPlays: number;
}

export const dbGetAllTracks = async (): Promise<DbTrack[]> => {
  return invoke('db_get_all_tracks');
};

export const dbGetTracksByIds = async (ids: string[]): Promise<DbTrack[]> => {
  return invoke('db_get_tracks_by_ids', { ids });
};

export const dbGetTracksByAlbumArtist = async (
  album: string,
  artist: string,
): Promise<DbTrack[]> => {
  return invoke('db_get_tracks_by_album_artist', { album, artist });
};

export const dbGetTracksPaginated = async (
  offset: number,
  limit: number,
  sortBy: string = 'dateAdded',
  sortOrder: string = 'desc',
): Promise<DbTrack[]> => {
  return invoke('db_get_tracks_paginated', { offset, limit, sortBy, sortOrder });
};

export const dbSearchTracks = async (
  query: string,
  limit: number = 50,
): Promise<SearchResult[]> => {
  return invoke('db_search_tracks', { query, limit });
};

export const dbGetExistingPaths = async (paths: string[]): Promise<string[]> => {
  if (paths.length === 0) return [];
  return invoke('db_get_existing_paths', { paths });
};

export const searchLyrics = async (
  query: string,
  limit: number = 50,
): Promise<LyricsSearchResult[]> => {
  return invoke('search_lyrics', { query, limit });
};

export const dbUpsertTracks = async (tracks: DbTrack[]): Promise<number> => {
  return invoke('db_upsert_tracks', { tracks });
};

export const dbGetTrackCount = async (): Promise<number> => {
  return invoke('db_get_track_count');
};

export const dbUpdatePlayStats = async (trackId: string): Promise<void> => {
  return invoke('db_update_play_stats', { trackId });
};

export const dbSetTrackRating = async (trackId: string, rating: number | null): Promise<void> => {
  return invoke('db_set_track_rating', { trackId, rating });
};

export const dbGetRecentlyAdded = async (
  days: number = 30,
  limit: number = 50,
): Promise<DbTrack[]> => {
  return invoke('db_get_recently_added', { days, limit });
};

export const dbGetMostPlayed = async (limit: number = 50): Promise<DbTrack[]> => {
  return invoke('db_get_most_played', { limit });
};

export const dbGetLibraryStats = async (): Promise<LibraryStats> => {
  return invoke('db_get_library_stats');
};

export const dbDeleteTracks = async (ids: string[]): Promise<number> => {
  return invoke('db_delete_tracks', { ids });
};

export const dbRenameTrackPath = async (oldPath: string, newPath: string): Promise<void> => {
  return invoke('db_rename_track_path', { oldPath, newPath });
};

export const dbDeleteTracksByFolder = async (folderPath: string): Promise<number> => {
  return invoke('db_delete_tracks_by_folder', { folderPath });
};

// ========== Image Cache Commands ==========

export interface CacheStats {
  totalSizeBytes: number;
  fileCount: number;
  oldestFile: number | null;
}

export const cacheGenerateThumbnail = async (imageDataBase64: string): Promise<string> => {
  return invoke('cache_generate_thumbnail', { imageData: imageDataBase64 });
};

export const cacheGetThumbnail = async (
  hash: string,
  size: 'small' | 'medium' | 'large',
): Promise<string | null> => {
  return invoke('cache_get_thumbnail', { hash, size });
};

export const cacheHasThumbnail = async (hash: string): Promise<boolean> => {
  return invoke('cache_has_thumbnail', { hash });
};

export const cacheGetStats = async (): Promise<CacheStats> => {
  return invoke('cache_get_stats');
};

export const cacheClear = async (keepRecentDays?: number): Promise<number> => {
  return invoke('cache_clear', { keepRecentDays });
};

export const cacheEnforceLimit = async (limitMb?: number): Promise<number> => {
  return invoke('cache_enforce_limit', { limitMb });
};

export const cacheGetThumbnailDataUrl = async (
  hash: string,
  size: 'small' | 'medium' | 'large',
): Promise<string | null> => {
  return invoke('cache_get_thumbnail_data_url', { hash, size });
};

// ========== Waveform Commands ==========

export interface WaveformData {
  peaks: number[];
  durationSecs: number;
  sampleRate: number;
  samplesPerSecond: number;
}

export interface WaveformCacheStats {
  memoryCount: number;
  diskCount: number;
  totalSizeBytes: number;
}

export const waveformGenerate = async (filePath: string): Promise<WaveformData> => {
  return invoke('waveform_generate', { filePath });
};

export const waveformCancel = async (filePath: string): Promise<void> => {
  return invoke('waveform_cancel', { filePath });
};

export const waveformHas = async (filePath: string): Promise<boolean> => {
  return invoke('waveform_has', { filePath });
};

export const waveformGetStats = async (): Promise<WaveformCacheStats> => {
  return invoke('waveform_get_stats');
};

export const waveformClearCache = async (): Promise<number> => {
  return invoke('waveform_clear_cache');
};

// ========== Desktop Integration Commands ==========

export const desktopOpenMiniWindow = async (): Promise<void> => {
  return invoke('desktop_open_mini_window');
};

export const desktopCloseMiniWindow = async (): Promise<void> => {
  return invoke('desktop_close_mini_window');
};

export const desktopToggleMiniWindow = async (): Promise<void> => {
  return invoke('desktop_toggle_mini_window');
};

export const desktopFocusMainWindow = async (): Promise<void> => {
  return invoke('desktop_focus_main_window');
};

export const desktopQuitApplication = async (): Promise<void> => {
  return invoke('desktop_quit_application');
};

export const desktopSetNativeUiState = async (payload: DesktopNativeUiState): Promise<void> => {
  return invoke('desktop_set_native_ui_state', { payload });
};

export const desktopSyncMediaSession = async (
  payload: DesktopMediaSessionSyncPayload,
): Promise<void> => {
  return invoke('desktop_sync_media_session', { payload });
};
