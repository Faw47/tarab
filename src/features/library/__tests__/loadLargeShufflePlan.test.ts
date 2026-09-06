import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLargeShufflePlan } from '../loadLargeShufflePlan';

const { fetchLibraryTrackIdsMock, fetchLibraryTracksByIdsMock, getSmartShuffleQueueMock } =
  vi.hoisted(() => ({
    fetchLibraryTrackIdsMock: vi.fn(),
    fetchLibraryTracksByIdsMock: vi.fn(),
    getSmartShuffleQueueMock: vi.fn(),
  }));

vi.mock('../api', () => ({
  fetchLibraryTrackIds: fetchLibraryTrackIdsMock,
  fetchLibraryTracksByIds: fetchLibraryTracksByIdsMock,
}));

vi.mock('../../../lib/tauri-commands', () => ({
  getSmartShuffleQueue: getSmartShuffleQueueMock,
}));

vi.mock('../loadTracksForShuffle', () => ({
  shuffleTracks: (items: string[]) => [...items],
}));

const track = (id: string) => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: `/${id}.mp3`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

describe('loadLargeShufflePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the smart order complete and fetches only the first bounded metadata batch', async () => {
    fetchLibraryTrackIdsMock.mockResolvedValue(['a', 'b', 'c']);
    getSmartShuffleQueueMock.mockResolvedValue(['c', 'c', 'missing']);
    fetchLibraryTracksByIdsMock.mockResolvedValue([track('a'), track('c')]);

    const plan = await loadLargeShufflePlan(true);

    expect(plan).toEqual({ orderedIds: ['c', 'a', 'b'], firstTrack: track('c') });
    expect(fetchLibraryTracksByIdsMock).toHaveBeenCalledWith(['c', 'a', 'b']);
  });

  it('uses a local id shuffle when smart shuffle is disabled', async () => {
    fetchLibraryTrackIdsMock.mockResolvedValue(['a']);
    fetchLibraryTracksByIdsMock.mockResolvedValue([track('a')]);

    const plan = await loadLargeShufflePlan(false);

    expect(plan?.firstTrack.id).toBe('a');
    expect(getSmartShuffleQueueMock).not.toHaveBeenCalled();
  });
});
