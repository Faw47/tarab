import { getLibraryQueryClient } from '../features/library/queryClientBridge';
import { libraryKeys } from '../features/library/queryKeys';
import { usePlayerStore } from '../store/player-store';
import { useSettingsStore } from '../store/settings-store';
import type { Track } from '../types';
import { getPathBaseName } from './path-utils';
import { reportError } from './report-error';
import { invalidateCoverArtCache } from '../hooks/useCoverArt';
import {
  dbGetTracksByIds,
  dbUpsertTracks,
  generateCoverArtHashes,
  getBatchMetadata,
} from './tauri-commands';

const getFallbackTitle = (filePath: string): string => getPathBaseName(filePath) || 'Unknown';

export const refreshTracksByFilePaths = async (filePaths: string[]): Promise<void> => {
  const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));
  if (uniquePaths.length === 0) return;

  let metadata;
  try {
    metadata = await getBatchMetadata(uniquePaths);
  } catch (err) {
    reportError('Failed to refresh metadata', { source: 'track-refresh', error: err });
    return;
  }
  if (metadata.length === 0) return;

  let coverArtHashMap = new Map<string, string | null>();
  const downloadArtwork = useSettingsStore.getState().downloadArtwork;
  const artTargets = downloadArtwork
    ? metadata.filter((m) => m.has_cover_art).map((m) => m.file_path)
    : [];
  if (downloadArtwork && artTargets.length > 0) {
    try {
      const hashed = await generateCoverArtHashes(artTargets);
      coverArtHashMap = new Map(hashed);
    } catch (err) {
      reportError('Failed to refresh cover art hashes', { source: 'track-refresh', error: err });
    }
  }

  const queryClient = getLibraryQueryClient();
  const libraryTracks = queryClient?.getQueryData<Track[]>(libraryKeys.tracks()) ?? [];
  const playerState = usePlayerStore.getState();
  const existingByPath = new Map<string, Track>();
  libraryTracks.forEach((track) => existingByPath.set(track.filePath, track));
  playerState.queue.forEach((track) => existingByPath.set(track.filePath, track));
  if (playerState.currentTrack) {
    existingByPath.set(playerState.currentTrack.filePath, playerState.currentTrack);
  }

  const updatedByPath = new Map<string, Track>();
  metadata.forEach((meta) => {
    const existing = existingByPath.get(meta.file_path);
    const coverArtHash = meta.has_cover_art
      ? (coverArtHashMap.get(meta.file_path) ?? existing?.coverArtHash ?? null)
      : null;
    const updated: Track = {
      id: meta.file_path,
      title: meta.title || existing?.title || getFallbackTitle(meta.file_path),
      artist: meta.artist || existing?.artist || 'Unknown Artist',
      albumArtist: meta.album_artist ?? existing?.albumArtist ?? null,
      album: meta.album || existing?.album || 'Unknown Album',
      year: meta.year,
      duration: meta.duration_secs,
      filePath: meta.file_path,
      hasCoverArt: !!meta.has_cover_art,
      coverArt: undefined,
      coverArtHash,
      fileFormat: meta.file_format,
      bitrate: meta.bitrate ?? undefined,
      sampleRate: meta.sample_rate ?? undefined,
      fileSize: meta.file_size ?? undefined,
      dateAdded: existing?.dateAdded ?? Date.now(),
      rating: existing?.rating ?? null,
    };
    updatedByPath.set(meta.file_path, updated);
  });

  if (updatedByPath.size > 0 && libraryTracks.length > 0) {
    const updatedTracks = libraryTracks.map((track) => updatedByPath.get(track.filePath) ?? track);
    queryClient?.setQueryData(libraryKeys.tracks(), updatedTracks);
  }

  if (playerState.queue.length > 0) {
    const updatedQueue = playerState.queue.map(
      (track) => updatedByPath.get(track.filePath) ?? track,
    );
    usePlayerStore.setState({ queue: updatedQueue });
  }

  if (playerState.currentTrack) {
    const updated = updatedByPath.get(playerState.currentTrack.filePath);
    if (updated) {
      usePlayerStore.setState({ currentTrack: updated, duration: updated.duration });
    }
  }

  try {
    const existingDb = await dbGetTracksByIds(uniquePaths);
    const dbById = new Map(existingDb.map((track) => [track.id, track]));
    const updates = metadata.map((meta) => {
      const dbTrack = dbById.get(meta.file_path);
      invalidateCoverArtCache(meta.file_path, dbTrack?.coverArtHash ?? null);
      const coverArtHash = meta.has_cover_art
        ? (coverArtHashMap.get(meta.file_path) ?? dbTrack?.coverArtHash ?? null)
        : null;
      return {
        id: meta.file_path,
        title: meta.title || dbTrack?.title || getFallbackTitle(meta.file_path),
        artist: meta.artist || dbTrack?.artist || 'Unknown Artist',
        albumArtist: meta.album_artist ?? dbTrack?.albumArtist ?? null,
        album: meta.album || dbTrack?.album || 'Unknown Album',
        year: meta.year,
        duration: meta.duration_secs,
        filePath: meta.file_path,
        hasCoverArt: !!meta.has_cover_art,
        coverArtHash,
        dateAdded: dbTrack?.dateAdded ?? updatedByPath.get(meta.file_path)?.dateAdded ?? Date.now(),
        playCount: dbTrack?.playCount ?? 0,
        lastPlayed: dbTrack?.lastPlayed ?? null,
        rating: dbTrack?.rating ?? null,
        blurhash: meta.blurhash || dbTrack?.blurhash || null,
      };
    });
    await dbUpsertTracks(updates);
    await queryClient?.invalidateQueries({ queryKey: libraryKeys.searchRoot() });
  } catch (err) {
    reportError('Failed to persist refreshed metadata', { source: 'track-refresh', error: err });
  }
};
