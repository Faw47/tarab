import type { DbShuffleQueueTrack } from '../../lib/tauri-commands';
import type { Track } from '../../types';

export function createLazyQueueTrack(reference: DbShuffleQueueTrack): Track {
  return {
    id: reference.id,
    _lazyQueueEntry: true,
    title: '',
    artist: '',
    album: '',
    year: null,
    duration: reference.duration,
    filePath: reference.id,
    hasCoverArt: false,
    coverArtHash: null,
    dateAdded: 0,
  };
}
