import { z } from 'zod';

export const DbTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  albumArtist: z.string().nullable().optional(),
  album: z.string(),
  year: z.number().nullable(),
  trackNumber: z.number().int().nonnegative().nullable().optional(),
  discNumber: z.number().int().nonnegative().nullable().optional(),
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
export const LibraryStatsSchema = z.object({
  trackCount: z.number().int().nonnegative(),
  totalDuration: z.number().nonnegative(),
  artistCount: z.number().int().nonnegative(),
  albumCount: z.number().int().nonnegative(),
  totalPlays: z.number().int().nonnegative(),
});
export const DbAlbumAggregateArraySchema = z.array(
  z.object({
    album: z.string(),
    artist: z.string(),
    trackCount: z.number().int().nonnegative(),
    representative: DbTrackSchema,
  }),
);
export const DbArtistAggregateArraySchema = z.array(
  z.object({
    artist: z.string(),
    trackCount: z.number().int().nonnegative(),
    representative: DbTrackSchema,
  }),
);

export type ValidatedDbTrack = z.infer<typeof DbTrackSchema>;
export type ValidatedLibraryStats = z.infer<typeof LibraryStatsSchema>;
