import { invoke as originalInvoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ipcBatchLimit } from './ipc-concurrency';
import { Perf } from './performance';

const invoke = <T>(cmd: string, args?: unknown): Promise<T> => {
  return Perf.measureIPC(cmd, args, originalInvoke);
};

import type {
  BackendSmartPlaylistRule,
  DesktopMediaSessionSyncPayload,
  DesktopMiniControlAction,
  DesktopMiniSeekPayload,
  DesktopNativeUiState,
  LoopMode,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistType,
  TagInfo,
  TagUpdate,
  TrackMetadata,
} from '../types';

// Audio playback commands
export interface GaplessPreloadIdentity {
  preloadId: string;
  generation: number;
  path: string;
}

export interface GaplessHandoff {
  outgoingPath: string;
  outgoingGeneration: number;
  preload: GaplessPreloadIdentity;
}

export type GaplessCancellationOutcome =
  | { status: 'cancelled'; preload: GaplessPreloadIdentity }
  | { status: 'handedOff'; handoff: GaplessHandoff }
  | { status: 'stale'; preload: GaplessPreloadIdentity };

export interface PlaybackSourceIdentity {
  generation: number;
  path: string;
}

export type SeekPlaybackOutcome =
  | {
      status: 'applied';
      position: number;
      gaplessCancellation: GaplessCancellationOutcome | null;
    }
  | {
      status: 'stale';
      expectedSource: PlaybackSourceIdentity;
      activeSource: PlaybackSourceIdentity | null;
      gaplessCancellation: GaplessCancellationOutcome | null;
    }
  | {
      status: 'failed';
      message: string;
      gaplessCancellation: GaplessCancellationOutcome | null;
    };

export const playTrack = async (
  filePath: string,
  startPos?: number,
  authorityId?: string,
): Promise<number> => {
  return invoke('play_track', {
    filePath,
    startPos,
    ...(authorityId ? { authorityId } : {}),
  });
};

export const crossfadeToTrack = async (
  filePath: string,
  durationSecs: number,
  startPos?: number,
): Promise<number> => {
  return invoke('crossfade_to_track', { filePath, startPos, durationSecs });
};

/** Queue-decoded next file on the current Sink for gapless playback (no crossfade). */
export const preloadNextTrack = async (filePath: string): Promise<GaplessPreloadIdentity> => {
  return invoke('preload_next_track', { filePath });
};

export const cancelGaplessPreload = async (
  preload: GaplessPreloadIdentity,
): Promise<GaplessCancellationOutcome> => {
  return invoke('cancel_gapless_preload', { preload });
};

export const pausePlayback = async (): Promise<void> => {
  return invoke('pause_playback');
};

export const resumePlayback = async (): Promise<void> => {
  return invoke('resume_playback');
};

export const stopPlayback = async (): Promise<number> => {
  return invoke('stop_playback');
};

export const seekPlayback = async (
  positionSecs: number,
  expectedSource: PlaybackSourceIdentity,
): Promise<SeekPlaybackOutcome> => {
  return invoke('seek_playback', { positionSecs, expectedSource });
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
  revision?: number;
  currentTrackId: string | null;
  queueIds: string[];
  queueIndex: number;
  currentTime: number;
  playbackSpeed: number;
  volume: number;
  wasPlaying: boolean;
  shuffleEnabled: boolean;
  loopMode: LoopMode;
  stopAfterCurrent: boolean;
  lastView?: string | null;
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

type FixedStoreName = 'settings' | 'player';

export const fixedStoreGet = async <T>(store: FixedStoreName, key: string): Promise<T | null> => {
  return invoke('fixed_store_get', { store, key });
};

export const fixedStoreSet = async (
  store: FixedStoreName,
  key: string,
  value: unknown,
): Promise<void> => {
  return invoke('fixed_store_set', { store, key, value });
};

export const fixedStoreRemove = async (store: FixedStoreName, key: string): Promise<void> => {
  return invoke('fixed_store_remove', { store, key });
};

export interface AudioOutputDeviceInfo {
  id: string;
  name: string;
}

export type AudioOutputSelection =
  | { status: 'selected'; deviceId: string }
  | { status: 'migrated'; deviceId: string }
  | {
      status: 'fallback';
      deviceId: 'system';
      reason: 'notFound' | 'ambiguousLegacyName' | 'unavailable';
    };

export interface AudioOutputSwitchOutcome {
  selection: AudioOutputSelection;
  gaplessCancellation: GaplessCancellationOutcome | null;
}

export const listAudioOutputDevices = (): Promise<AudioOutputDeviceInfo[]> => {
  return invoke('list_audio_output_devices');
};

export const setAudioOutputDevice = (deviceId: string): Promise<AudioOutputSwitchOutcome> => {
  return invoke('set_audio_output_device', { deviceId });
};

// File operations
export const renameFile = async (oldPath: string, newName: string): Promise<string> => {
  return invoke('rename_file', { oldPath, newName });
};

export const moveFile = async (oldPath: string, newPath: string): Promise<string> => {
  return invoke('move_file', { oldPath, newPath });
};

export const deleteFiles = async (filePaths: string[]): Promise<FileMutationResult[]> => {
  return invoke('delete_files', { filePaths });
};

export const trashFiles = async (filePaths: string[]): Promise<FileMutationResult[]> => {
  return invoke('trash_files', { filePaths });
};

export const restoreTrashedFiles = async (undoTokens: string[]): Promise<FileMutationResult[]> => {
  return invoke('restore_trashed_files', { undoTokens });
};

export interface RecoverableTrashEntry {
  undoToken: string;
  originalPath: string;
  displayName: string;
  sizeBytes: number;
  createdAtMs: number;
  status: 'available' | 'restorePending' | 'missing';
}

export const listRecoverableTrashEntries = async (): Promise<RecoverableTrashEntry[]> => {
  return invoke('list_recoverable_trash_entries');
};

export const purgeTrashedFiles = async (undoTokens: string[]): Promise<FileMutationResult[]> => {
  return invoke('purge_trashed_files', { undoTokens });
};

export const revealInFileManager = async (path: string): Promise<void> => {
  return invoke('reveal_in_file_manager', { path });
};

export interface LibraryGrantSummary {
  id: string;
  path: string;
  displayName: string;
  status: 'available' | 'missing';
}

export interface LibraryHealthState {
  nativeGrants: LibraryGrantSummary[];
  cachedSources: Array<{
    grantId: string;
    path: string;
    indexedTrackCount: number;
  }>;
  unavailableSources: LibraryGrantSummary[];
  watcherState: 'inactive' | 'ready';
  repairActions: Array<'reauthorize' | 'addFolder' | 'viewDetails' | 'rescan'>;
}

export const listLibraryGrants = async (): Promise<LibraryGrantSummary[]> => {
  return invoke('list_library_grants');
};

export const getLibraryHealth = async (): Promise<LibraryHealthState> => {
  return invoke('get_library_health');
};

export const selectLibraryFolder = async (): Promise<LibraryGrantSummary | null> => {
  return invoke('select_library_folder');
};

export const reauthorizeLibraryGrant = async (
  grantId: string,
): Promise<LibraryGrantSummary | null> => {
  return invoke('reauthorize_library_grant', { grantId });
};

export interface LibrarySourceRemovalResult {
  grantId: string;
  path: string;
  removedTrackCount: number;
  databaseCleanupCompleted: boolean;
  cleanupPending: boolean;
  cleanupError: string | null;
}

export const removeLibrarySource = async (grantId: string): Promise<LibrarySourceRemovalResult> => {
  return invoke('remove_library_source', { grantId });
};

export const watchLibraryPaths = async (paths: string[]): Promise<void> => {
  return invoke('watch_library_paths', { paths });
};

// Library commands
interface LibraryScanPathChunk {
  scanId: string;
  paths: string[];
}

interface LibraryScanStreamSummary {
  scanId: string;
  pathCount: number;
}

const streamLibraryScan = async (
  scanId: string,
  runScan: (scanId: string) => Promise<LibraryScanStreamSummary>,
): Promise<string[]> => {
  const paths: string[] = [];
  let expectedCount: number | null = null;
  let resolveComplete: (() => void) | null = null;
  let streamTimeout: number | null = null;
  const unlisten = await listen<LibraryScanPathChunk>('library-scan-path-chunk', (event) => {
    if (event.payload.scanId === scanId) {
      paths.push(...event.payload.paths);
      if (expectedCount !== null && paths.length >= expectedCount) {
        resolveComplete?.();
      }
    }
  });
  try {
    const summary = await runScan(scanId);
    if (summary.scanId !== scanId) {
      throw new Error('Library scan stream returned an invalid scan identifier.');
    }
    expectedCount = summary.pathCount;
    if (paths.length < expectedCount) {
      await new Promise<void>((resolve, reject) => {
        resolveComplete = () => {
          if (streamTimeout !== null) {
            window.clearTimeout(streamTimeout);
            streamTimeout = null;
          }
          resolve();
        };
        streamTimeout = window.setTimeout(() => {
          streamTimeout = null;
          reject(new Error('Library scan path stream timed out.'));
        }, 5_000);
      });
    }
    if (summary.pathCount !== paths.length) {
      throw new Error('Library scan stream did not deliver the expected number of paths.');
    }
    return paths;
  } finally {
    if (streamTimeout !== null) {
      window.clearTimeout(streamTimeout);
      streamTimeout = null;
    }
    resolveComplete = null;
    unlisten();
  }
};

export const finishLibraryScan = async (scanId: string): Promise<void> => {
  return invoke('finish_library_scan', { scanId });
};

export const scanLibrary = async (
  folderPath: string,
  followLinks?: boolean,
  providedScanId?: string,
): Promise<string[]> => {
  const scanId = providedScanId ?? crypto.randomUUID();
  try {
    return await streamLibraryScan(scanId, (id) =>
      invoke('scan_library', {
        scanId: id,
        folderPath,
        followLinks,
      }),
    );
  } finally {
    if (!providedScanId) await finishLibraryScan(scanId).catch(() => undefined);
  }
};

export const cancelLibraryScan = async (scanId: string): Promise<void> => {
  return invoke('cancel_library_scan', { scanId });
};

export const scanLibraryParallel = async (
  folderPath: string,
  followLinks?: boolean,
  providedScanId?: string,
): Promise<string[]> => {
  const scanId = providedScanId ?? crypto.randomUUID();
  try {
    return await streamLibraryScan(scanId, (id) =>
      invoke('scan_library_parallel', {
        scanId: id,
        folderPath,
        followLinks,
      }),
    );
  } finally {
    if (!providedScanId) await finishLibraryScan(scanId).catch(() => undefined);
  }
};

export const getTrackMetadata = async (
  filePath: string,
  authorityId?: string,
): Promise<TrackMetadata> => {
  return invoke('get_track_metadata', {
    filePath,
    ...(authorityId ? { authorityId } : {}),
  });
};

export const getCoverArt = async (filePath: string): Promise<string | null> => {
  return invoke('get_cover_art', { filePath });
};

export interface CoverArtResolution {
  status: 'ready' | 'noArt' | 'sourceUnavailable' | 'invalidRequest';
  hash: string | null;
  size: 'small' | 'medium' | 'large';
  cacheAvailable: boolean;
  regenerated: boolean;
  failureReason: 'missingLibraryGrant' | 'sourceAccessDenied' | 'unsupportedSize' | null;
}

export const resolveCoverArt = async (
  filePath: string,
  preferredHash: string | null,
  size: 'small' | 'medium' | 'large',
): Promise<CoverArtResolution> => {
  return invoke('resolve_cover_art', { filePath, preferredHash, size });
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
  genre?: string | null;
  year: number | null;
  track_number: number | null;
  disc_number: number | null;
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
  genre?: string | null;
  year: number | null;
  track_number: number | null;
  disc_number: number | null;
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
  force = false,
): Promise<[string, string | null][]> => {
  return ipcBatchLimit(async () => {
    const result: [string, [string, string | null] | null][] = await invoke(
      'generate_cover_art_hashes',
      { filePaths, force },
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

export type ArtworkMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface SelectedArtwork {
  base64: string;
  mime: ArtworkMime;
}

export const pickCoverArt = async (): Promise<SelectedArtwork | null> => {
  return invoke('pick_cover_art');
};

// Playlist commands
export const getPlaylists = async (): Promise<PlaylistSummary[]> => {
  return invoke('get_playlists');
};

export const getPlaylistDetail = async (playlistId: string): Promise<PlaylistDetail> => {
  return invoke('get_playlist_detail', { playlistId });
};

export const createPlaylist = async (
  name: string,
  playlistType: PlaylistType,
  smartRules?: BackendSmartPlaylistRule[],
  folderPath?: string,
): Promise<PlaylistDetail> => {
  return invoke('create_playlist', { name, playlistType, smartRules, folderPath });
};

export const updatePlaylist = async (
  playlistId: string,
  name?: string,
  playlistType?: PlaylistType,
  trackIds?: string[],
  smartRules?: BackendSmartPlaylistRule[],
  folderPath?: string,
): Promise<PlaylistDetail> => {
  return invoke('update_playlist', {
    request: { playlistId, name, playlistType, trackIds, smartRules, folderPath },
  });
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
  mutationId: string,
): Promise<PlaylistDetail> => {
  return invoke('add_tracks_to_playlist', { playlistId, trackIds, mutationId });
};

export const removeTracksFromPlaylist = async (
  playlistId: string,
  trackIds: string[],
): Promise<PlaylistDetail> => {
  return invoke('remove_tracks_from_playlist', { playlistId, trackIds });
};

export const relinkPlaylistTrack = async (
  playlistId: string,
  oldTrackId: string,
  newTrackId: string,
): Promise<PlaylistDetail> => {
  return invoke('relink_playlist_track', { playlistId, oldTrackId, newTrackId });
};

export const reorderPlaylistTracks = async (
  playlistId: string,
  trackIds: string[],
  mutationId: string,
): Promise<PlaylistDetail> => {
  return invoke('reorder_playlist_tracks', { playlistId, trackIds, mutationId });
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

export const revealPlaylistsDataFolder = async (): Promise<void> => {
  return invoke('reveal_playlists_data_folder');
};

// Tag editor commands
export const readFullTags = async (filePath: string): Promise<TagInfo> => {
  return invoke('read_full_tags', { filePath });
};

export const writeTags = async (
  filePath: string,
  updates: TagUpdate,
): Promise<FileMutationResult> => {
  return invoke('write_tags', { filePath, updates });
};

export interface FileMutationResult {
  path: string;
  status: 'success' | 'failed';
  operation: 'writeTags' | 'trash' | 'restore' | 'purge' | 'delete';
  errorCode: string | null;
  recoverable: boolean;
  errorMessage: string | null;
  undoToken: string | null;
}

export const writeTagsBatch = async (
  filePaths: string[],
  updates: TagUpdate,
): Promise<FileMutationResult[]> => {
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
  genre?: string | null;
  year: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  duration: number;
  filePath: string;
  hasCoverArt: boolean;
  coverArtHash: string | null;
  dateAdded: number;
  playCount: number;
  lastPlayed: number | null;
  rating: number | null;
  blurhash: string | null;
  fileFormat?: string | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  fileSize?: number | null;
}

export interface DbTrackPageCursor {
  revision: number;
  lastId: string;
  sortBy: string;
  sortOrder: string;
}

export interface DbTrackCursorPage {
  status: 'ready' | 'restartRequired';
  tracks: DbTrack[];
  nextCursor: DbTrackPageCursor | null;
  revision: number;
  totalCount: number;
}

export interface DbAlbumAggregate {
  album: string;
  artist: string;
  trackCount: number;
  representative: DbTrack;
}

export interface DbArtistAggregate {
  artist: string;
  trackCount: number;
  representative: DbTrack;
}

export interface ScanReconcileError {
  path: string | null;
  code: string;
  message: string;
  recoverable: boolean;
}

export interface ScanReconcileRequest {
  folderPath: string;
  discoveredPaths: string[];
  tracks: DbTrack[];
  traversalComplete: boolean;
  errors: ScanReconcileError[];
}

export interface ScanReconcileResult {
  status: 'complete' | 'partial' | 'failed';
  folderPath: string;
  discoveredCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  missingCount: number;
  preservedCount: number;
  errors: ScanReconcileError[];
}

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  filePath: string;
  coverArtHash: string | null;
  blurhash: string | null;
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

export const dbGetAllTrackIds = async (): Promise<string[]> => {
  return invoke('db_get_all_track_ids');
};

export const dbGetTracksByIds = async (ids: string[]): Promise<DbTrack[]> => {
  return invoke('db_get_tracks_by_ids', { ids });
};

export const dbGetTrackByPublicId = async (publicId: string): Promise<DbTrack | null> => {
  return invoke('db_get_track_by_public_id', { publicId });
};

export const getInitialDeepLinks = async (): Promise<string[]> => {
  return invoke('get_initial_deep_links');
};

export interface LaunchFileIntent {
  id: string;
  displayName: string;
  folderName: string;
}

export interface ResolvedLaunchFileIntent {
  filePath: string;
  libraryGrant: LibraryGrantSummary | null;
  authorityId: string | null;
}

export type LaunchFileIntentAction = 'playOnce' | 'importFolder' | 'cancel';

export const listLaunchFileIntents = async (): Promise<LaunchFileIntent[]> => {
  return invoke('list_launch_file_intents');
};

export const resolveLaunchFileIntent = async (
  intentId: string,
  action: LaunchFileIntentAction,
): Promise<ResolvedLaunchFileIntent | null> => {
  return invoke('resolve_launch_file_intent', { intentId, action });
};

export const revokeLaunchFileAuthority = async (authorityId: string): Promise<void> => {
  return invoke('revoke_launch_file_authority', { authorityId });
};

export const dbGetTracksByAlbumArtist = async (
  album: string,
  artist: string,
): Promise<DbTrack[]> => {
  return invoke('db_get_tracks_by_album_artist', { album, artist });
};

export const dbGetTracksByArtist = async (artist: string): Promise<DbTrack[]> => {
  return invoke('db_get_tracks_by_artist', { artist });
};

export const dbGetAlbumAggregates = async (): Promise<DbAlbumAggregate[]> => {
  return invoke('db_get_album_aggregates');
};

export const dbGetArtistAggregates = async (): Promise<DbArtistAggregate[]> => {
  return invoke('db_get_artist_aggregates');
};

export const dbGetTracksPaginated = async (
  offset: number,
  limit: number,
  sortBy: string = 'dateAdded',
  sortOrder: string = 'desc',
): Promise<DbTrack[]> => {
  return invoke('db_get_tracks_paginated', { offset, limit, sortBy, sortOrder });
};

export const dbGetTracksCursorPage = async (
  cursor: DbTrackPageCursor | null,
  limit: number,
  sortBy: string = 'dateAdded',
  sortOrder: string = 'desc',
): Promise<DbTrackCursorPage> => {
  return invoke('db_get_tracks_cursor_page', { cursor, limit, sortBy, sortOrder });
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

export const dbReconcileFolderScan = async (
  request: ScanReconcileRequest,
  scanId: string,
): Promise<ScanReconcileResult> => {
  return invoke('db_reconcile_folder_scan', { request, scanId });
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

export const cacheGetThumbnailBytes = async (
  hash: string,
  size: 'small' | 'medium' | 'large',
): Promise<number[] | null> => {
  return invoke('cache_get_thumbnail_bytes', { hash, size });
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

export const desktopMarkRendererReady = async (): Promise<void> => {
  return invoke('desktop_mark_renderer_ready');
};

export const desktopMiniControl = async (action: DesktopMiniControlAction): Promise<void> => {
  return invoke('desktop_mini_control', { action });
};

export const desktopMiniSeek = async (payload: DesktopMiniSeekPayload): Promise<void> => {
  return invoke('desktop_mini_seek', { payload });
};

export const desktopMiniRequestSnapshot = async (): Promise<void> => {
  return invoke('desktop_mini_request_snapshot');
};

export const desktopSetNativeUiState = async (payload: DesktopNativeUiState): Promise<void> => {
  return invoke('desktop_set_native_ui_state', { payload });
};

export const desktopSyncMediaSession = async (
  payload: DesktopMediaSessionSyncPayload,
): Promise<void> => {
  return invoke('desktop_sync_media_session', { payload });
};
