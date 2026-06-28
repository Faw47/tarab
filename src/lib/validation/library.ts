import { z } from 'zod';

export const DbTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  albumArtist: z.string().nullable().optional(),
  album: z.string(),
  year: z.number().nullable(),
  duration: z.number(),
  filePath: z.string(),
  hasCoverArt: z.boolean(),
  coverArtHash: z.string().nullable(),
  dateAdded: z.number(),
  playCount: z.number(),
  lastPlayed: z.number().nullable(),
  rating: z.number().nullable(),
  blurhash: z.string().nullable().optional(),
  fileFormat: z.string().nullable().optional(),
  bitrate: z.number().nullable().optional(),
  sampleRate: z.number().nullable().optional(),
  fileSize: z.number().nullable().optional(),
});

export const DbTrackArraySchema = z.array(DbTrackSchema);
export const TrackCountSchema = z.number().int().nonnegative();
export const AffectedRowCountSchema = z.number().int().nonnegative();

export type ValidatedDbTrack = z.infer<typeof DbTrackSchema>;
