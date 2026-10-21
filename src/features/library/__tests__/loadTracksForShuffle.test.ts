import { describe, expect, it } from 'vitest';
import { createLazyQueueTrack } from '../loadTracksForShuffle';

describe('createLazyQueueTrack', () => {
  it('keeps only the playback ID and duration until metadata is needed', () => {
    const track = createLazyQueueTrack({
      id: '/music/song.mp3',
      duration: 201.5,
    });

    expect(track).toEqual({
      id: '/music/song.mp3',
      _lazyQueueEntry: true,
      title: '',
      artist: '',
      album: '',
      year: null,
      duration: 201.5,
      filePath: '/music/song.mp3',
      hasCoverArt: false,
      coverArtHash: null,
      dateAdded: 0,
    });
    expect(track.playCount).toBeUndefined();
    expect(track.fileSize).toBeUndefined();
  });
});
