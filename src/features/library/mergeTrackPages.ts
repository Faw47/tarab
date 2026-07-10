import type { Track } from '../../types';

export function mergeTrackPages(previous: Track[], incoming: Track[]): Track[] {
  const seen = new Set(previous.map((track) => track.id));
  const additions: Track[] = [];

  for (const track of incoming) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    additions.push(track);
  }

  return additions.length > 0 ? [...previous, ...additions] : previous;
}
