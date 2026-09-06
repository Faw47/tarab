import { invalidateLibraryForMutation } from '../features/library/mutations';
import { getLibraryQueryClient } from '../features/library/queryClientBridge';
import { libraryKeys } from '../features/library/queryKeys';
import { invalidateCoverArtCache } from '../hooks/useCoverArt';
import { usePlayerStore } from '../store/player-store';

import type { Track } from '../types';
import { getPathBaseName } from './path-utils';
import { reportError } from './report-error';
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
  try {
    const hashed = await generateCoverArtHashes(
      metadata.map((item) => item.file_path),
      true,
    );
    coverArtHashMap = new Map(hashed);
  } catch (err) {
    reportError('Failed to refresh cover art hashes', { source: 'track-refresh', error: err });
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
      genre: meta.genre ?? null,
      year: meta.year,
      trackNumber: meta.track_number,
      discNumber: meta.disc_number,
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

  if (playerState.queue.length > 0 || playerState.currentTrack) {
    usePlayerStore.setState((state) => {
      const refreshTrack = (track: Track): Track => {
        const refreshed = updatedByPath.get(track.filePath);
        return refreshed ? { ...track, ...refreshed, _queueId: track._queueId } : track;
      };
      const queue = state.queue.map(refreshTrack);
      let currentTrack = state.currentTrack ? refreshTrack(state.currentTrack) : null;
      if (currentTrack?._queueId) {
        currentTrack =
          queue.find((track) => track._queueId === currentTrack?._queueId) ?? currentTrack;
      }
      return currentTrack
        ? { queue, currentTrack, duration: currentTrack.duration }
        : { queue, currentTrack };
    });
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
        genre: meta.genre ?? null,
        year: meta.year,
        trackNumber: meta.track_number,
        discNumber: meta.disc_number,
        duration: meta.duration_secs,
        filePath: meta.file_path,
        hasCoverArt: !!meta.has_cover_art,
        coverArtHash,
        dateAdded: dbTrack?.dateAdded ?? updatedByPath.get(meta.file_path)?.dateAdded ?? Date.now(),
        playCount: dbTrack?.playCount ?? 0,
        lastPlayed: dbTrack?.lastPlayed ?? null,
        rating: dbTrack?.rating ?? null,
        blurhash: meta.blurhash || dbTrack?.blurhash || null,
        fileFormat: meta.file_format,
        bitrate: meta.bitrate,
        sampleRate: meta.sample_rate,
        fileSize: meta.file_size,
      };
    });
    await dbUpsertTracks(updates);
    if (queryClient) {
      await invalidateLibraryForMutation(queryClient, 'upsert');
    }
  } catch (err) {
    reportError('Failed to persist refreshed metadata', { source: 'track-refresh', error: err });
  }
};
