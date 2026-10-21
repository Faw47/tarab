import type { Track } from '../../types';
import { cursorAfterTrack, fetchLibraryTracksPage } from './api';

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
  let cursor: ReturnType<typeof cursorAfterTrack> | null = null;

  while (tracksById.size < totalTracks) {
    const page = await fetchLibraryTracksPage({
      cursor,
      limit: SHUFFLE_PAGE_SIZE,
      sortBy: 'dateAdded',
      sortOrder: 'desc',
    });

    if (page.length === 0) break;

    cursor = cursorAfterTrack(page[page.length - 1], 'dateAdded');
    for (const track of page) {
      if (!tracksById.has(track.id)) tracksById.set(track.id, track);
    }
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
