import type { Track } from '../../types';
import { fetchLibraryTracksPage } from './api';

export const SHUFFLE_PAGE_SIZE = 1000;

export async function loadTracksForShuffle({
  loadedTracks,
  totalTracks,
}: {
  loadedTracks: Track[];
  totalTracks: number;
}): Promise<Track[]> {
  if (totalTracks <= loadedTracks.length) return loadedTracks;

  const tracksById = new Map<string, Track>();
  let offset = 0;

  while (offset < totalTracks) {
    const page = await fetchLibraryTracksPage({
      offset,
      limit: SHUFFLE_PAGE_SIZE,
      sortBy: 'dateAdded',
      sortOrder: 'desc',
    });

    if (page.length === 0) break;

    for (const track of page) {
      if (!tracksById.has(track.id)) tracksById.set(track.id, track);
    }

    offset += page.length;
    if (page.length < SHUFFLE_PAGE_SIZE) break;
  }

  return tracksById.size > 0 ? Array.from(tracksById.values()) : loadedTracks;
}

export function shuffleTracks<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
