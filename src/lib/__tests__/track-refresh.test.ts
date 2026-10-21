import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLibraryQueryClient } from '../../features/library/queryClientBridge';
import { libraryKeys } from '../../features/library/queryKeys';
import type { Track, TrackMetadata } from '../../types';
import { refreshTracksByFilePaths } from '../track-refresh';

const { getBatchMetadataMock, dbUpsertTracksMock } = vi.hoisted(() => ({
  getBatchMetadataMock: vi.fn(),
  dbUpsertTracksMock: vi.fn(),
}));

vi.mock('../tauri-commands', () => ({
  dbGetTracksByIds: vi.fn(async () => []),
  dbUpsertTracks: dbUpsertTracksMock,
  generateCoverArtHashes: vi.fn(async () => []),
  getBatchMetadata: getBatchMetadataMock,
}));

vi.mock('../../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const track = (id: string, title: string): Track => ({
  id,
  title,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 100,
  filePath: id,
  hasCoverArt: false,
  dateAdded: 1,
});

describe('refreshTracksByFilePaths', () => {
  let client: QueryClient;

  beforeEach(() => {
    getBatchMetadataMock.mockReset();
    dbUpsertTracksMock.mockReset();
    client = new QueryClient();
    setLibraryQueryClient(client);
  });

  it('updates every sorted library list after a tag edit', async () => {
    const edited = track('/music/a.flac', 'Old title');
    const other = track('/music/b.flac', 'Other');
    client.setQueryData(libraryKeys.tracks('dateAdded'), [edited, other]);
    client.setQueryData(libraryKeys.tracks('title'), [other, edited]);
    getBatchMetadataMock.mockResolvedValue([
      {
        file_path: edited.filePath,
        title: 'New title',
        artist: 'Artist',
        album: 'Album',
        album_artist: null,
        genre: null,
        year: null,
        track_number: null,
        disc_number: null,
        duration_secs: 100,
        has_cover_art: false,
        file_format: 'flac',
        bitrate: null,
        sample_rate: null,
        file_size: null,
      } satisfies TrackMetadata,
    ]);

    await refreshTracksByFilePaths([edited.filePath]);

    for (const sortBy of ['dateAdded', 'title'] as const) {
      const titles = client
        .getQueryData<Track[]>(libraryKeys.tracks(sortBy))
        ?.map((item) => item.title);
      expect(titles).toContain('New title');
      expect(titles).not.toContain('Old title');
    }
    expect(client.getQueryData(libraryKeys.tracks())).toBeUndefined();
  });
  it('keeps refreshed genres in the library cache and database payload', async () => {
    const edited = { ...track('/music/genre.flac', 'Song'), genre: 'Rock' };
    client.setQueryData(libraryKeys.tracks('dateAdded'), [edited]);
    getBatchMetadataMock.mockResolvedValue([
      {
        file_path: edited.filePath,
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        album_artist: null,
        genre: 'Jazz',
        year: null,
        track_number: null,
        disc_number: null,
        duration_secs: 100,
        has_cover_art: false,
        file_format: 'flac',
        bitrate: null,
        sample_rate: null,
        file_size: null,
      } satisfies TrackMetadata,
    ]);

    await refreshTracksByFilePaths([edited.filePath]);

    expect(client.getQueryData<Track[]>(libraryKeys.tracks('dateAdded'))?.[0].genre).toBe('Jazz');
    expect(dbUpsertTracksMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: edited.filePath, genre: 'Jazz' }),
    ]);
  });

});
