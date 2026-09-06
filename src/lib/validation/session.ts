import { z } from 'zod';

export const PlaybackSessionSchema = z.object({
  version: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative().optional(),
  currentTrackId: z.string().nullable(),
  queueIds: z.array(z.string().min(1)),
  queueIndex: z.number().int(),
  currentTime: z.number(),
  playbackSpeed: z.number().positive(),
  volume: z.number().min(0).max(1),
  wasPlaying: z.boolean(),
  shuffleEnabled: z.boolean(),
  loopMode: z.enum(['off', 'all', 'one']),
  stopAfterCurrent: z.boolean(),
  lastView: z.string().nullable().optional(),
  lastOpenedAlbum: z.string().nullable().optional(),
  lastOpenedArtist: z.string().nullable().optional(),
  lastOpenedAlbumKey: z.string().nullable().optional(),
  timestamp: z.number().int().nonnegative(),
});
