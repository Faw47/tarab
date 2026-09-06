import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import { refreshTracksByFilePaths } from '../track-refresh';

const {
  dbGetTracksByIdsMock,
  dbUpsertTracksMock,
  generateCoverArtHashesMock,
  getBatchMetadataMock,
  queryClientMock,
  invalidateLibraryForMutationMock,
} = vi.hoisted(() => ({
  dbGetTracksByIdsMock: vi.fn(async (): Promise<Track[]> => []),
  dbUpsertTracksMock: vi.fn(async () => 1),
  generateCoverArtHashesMock: vi.fn(async (): Promise<[string, string | null][]> => []),
  getBatchMetadataMock: vi.fn(),
  queryClientMock: {
    getQueryData: vi.fn(() => []),
    setQueryData: vi.fn(),
  },
  invalidateLibraryForMutationMock: vi.fn(async () => undefined),
}));

vi.mock('../tauri-commands', () => ({
  dbGetTracksByIds: dbGetTracksByIdsMock,
  dbUpsertTracks: dbUpsertTracksMock,
  generateCoverArtHashes: generateCoverArtHashesMock,
  getBatchMetadata: getBatchMetadataMock,
}));
vi.mock('../../features/library/queryClientBridge', () => ({
  getLibraryQueryClient: () => queryClientMock,
}));
vi.mock('../../features/library/mutations', () => ({
  invalidateLibraryForMutation: invalidateLibraryForMutationMock,
}));
vi.mock('../../hooks/useCoverArt', () => ({
  invalidateCoverArtCache: vi.fn(),
}));
vi.mock('../report-error', () => ({ reportError: vi.fn() }));

const initialPlayerState = usePlayerStore.getState();

const duplicateTrack = (queueId: string): Track => ({
  id: '/music/duplicate.mp3',
  _queueId: queueId,
  title: 'Old title',
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/duplicate.mp3',
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

describe('refreshTracksByFilePaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState(initialPlayerState, true);
    useSettingsStore.setState({ downloadArtwork: false });
    getBatchMetadataMock.mockResolvedValue([
      {
        title: 'Refreshed title',
        artist: 'Artist',
        album_artist: null,
        album: 'Album',
        year: 2025,
        track_number: 2,
        disc_number: 1,
        duration_secs: 181,
        file_path: '/music/duplicate.mp3',
        has_cover_art: false,
        cover_art_hash: null,
        blurhash: null,
        file_format: 'mp3',
        bitrate: 320_000,
        sample_rate: 48_000,
        file_size: 1_024,
      },
    ]);
  });

  it('retains every duplicate queue ID and reuses the active queue occurrence', async () => {
    const first = duplicateTrack('duplicate-first');
    const active = duplicateTrack('duplicate-active');
    usePlayerStore.setState({
      queue: [first, active],
      queueIndex: 1,
      currentTrack: active,
      duration: active.duration,
    });

    await refreshTracksByFilePaths(['/music/duplicate.mp3']);

    const state = usePlayerStore.getState();
    expect(state.queue.map((track) => track._queueId)).toEqual([
      'duplicate-first',
      'duplicate-active',
    ]);
    expect(state.queue.map((track) => track.title)).toEqual(['Refreshed title', 'Refreshed title']);
    expect(state.currentTrack).toBe(state.queue[1]);
    expect(state.currentTrack?._queueId).toBe('duplicate-active');
    expect(state.duration).toBe(181);
    expect(invalidateLibraryForMutationMock).toHaveBeenCalledWith(queryClientMock, 'upsert');
  });

  it('clears a removed genre from the active queue and persisted track', async () => {
    const existing = {
      ...duplicateTrack('genre'),
      genre: 'Classical',
    };
    usePlayerStore.setState({
      queue: [existing],
      currentTrack: existing,
      duration: existing.duration,
    });
    dbGetTracksByIdsMock.mockResolvedValueOnce([existing]);
    getBatchMetadataMock.mockResolvedValueOnce([
      {
        title: 'Refreshed title',
        artist: 'Artist',
        album_artist: null,
        album: 'Album',
        genre: null,
        year: 2025,
        track_number: 2,
        disc_number: 1,
        duration_secs: 181,
        file_path: '/music/duplicate.mp3',
        has_cover_art: false,
        cover_art_hash: null,
        blurhash: null,
        file_format: 'mp3',
        bitrate: 320_000,
        sample_rate: 48_000,
        file_size: 1_024,
      },
    ]);

    await refreshTracksByFilePaths(['/music/duplicate.mp3']);

    expect(usePlayerStore.getState().currentTrack?.genre).toBeNull();
    expect(dbUpsertTracksMock).toHaveBeenCalledWith([
      expect.objectContaining({
        genre: null,
      }),
    ]);
  });

  it('force-refreshes artwork after metadata edits even when artwork prefetch is disabled', async () => {
    const existing = {
      ...duplicateTrack('artwork'),
      hasCoverArt: true,
      coverArtHash: 'old-hash',
    };
    dbGetTracksByIdsMock.mockResolvedValueOnce([existing]);
    getBatchMetadataMock.mockResolvedValueOnce([
      {
        title: 'Refreshed title',
        artist: 'Artist',
        album_artist: null,
        album: 'Album',
        year: 2025,
        track_number: 2,
        disc_number: 1,
        duration_secs: 181,
        file_path: '/music/duplicate.mp3',
        has_cover_art: true,
        cover_art_hash: null,
        blurhash: 'new-blurhash',
        file_format: 'mp3',
        bitrate: 320_000,
        sample_rate: 48_000,
        file_size: 1_024,
      },
    ]);
    generateCoverArtHashesMock.mockResolvedValueOnce([['/music/duplicate.mp3', 'new-hash']]);

    await refreshTracksByFilePaths(['/music/duplicate.mp3']);

    expect(generateCoverArtHashesMock).toHaveBeenCalledWith(['/music/duplicate.mp3'], true);
    expect(dbUpsertTracksMock).toHaveBeenCalledWith([
      expect.objectContaining({
        filePath: '/music/duplicate.mp3',
        hasCoverArt: true,
        coverArtHash: 'new-hash',
      }),
    ]);
  });
});
