import { z } from 'zod';

export const PlaylistTypeSchema = z.enum(['Manual', 'Smart', 'FolderSync']);

export const BackendSmartPlaylistRuleSchema = z.union([
  z.object({ RecentlyAdded: z.object({ days: z.number() }) }),
  z.object({ MostPlayed: z.object({ min_plays: z.number() }) }),
  z.object({ TopRated: z.object({ min_rating: z.number() }) }),
  z.object({ ByArtist: z.object({ artist: z.string() }) }),
  z.object({ ByAlbum: z.object({ album: z.string() }) }),
  z.object({ ByGenre: z.object({ genre: z.string() }) }),
  z.object({ ByYear: z.object({ start_year: z.number(), end_year: z.number() }) }),
  z.object({ LongerThan: z.object({ seconds: z.number() }) }),
  z.object({ ShorterThan: z.object({ seconds: z.number() }) }),
]);

/** Serde / JSON often emits `null` for absent optional fields; Zod `.optional()` does not accept null. */
const nullToUndefined = <T>(v: T | null | undefined): T | undefined =>
  v === null ? undefined : v;

export const PlaylistSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  playlistType: PlaylistTypeSchema,
  trackCount: z.number(),
  missingCount: z.number(),
  smartRules: z.preprocess(
    nullToUndefined,
    z.array(BackendSmartPlaylistRuleSchema).optional(),
  ),
  folderPath: z.preprocess(nullToUndefined, z.string().optional()),
  createdAt: z.number(),
  updatedAt: z.number(),
  isPinned: z.boolean().optional(),
  pinnedAt: z.number().nullable().optional(),
  lastSyncedAt: z.number().nullable().optional(),
  syncError: z.string().nullable().optional(),
});

export const PlaylistSummaryArraySchema = z.array(PlaylistSummarySchema);

export const PlaylistEntrySchema = z.object({
  trackId: z.string(),
  position: z.number(),
  available: z.boolean(),
  title: z.string().nullable().optional(),
  artist: z.string().nullable().optional(),
  album: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  filePath: z.string().nullable().optional(),
  hasCoverArt: z.boolean(),
  coverArtHash: z.string().nullable().optional(),
  blurhash: z.string().nullable().optional(),
});

export const PlaylistDetailSchema = PlaylistSummarySchema.extend({
  trackIds: z.array(z.string()),
  entries: z.array(PlaylistEntrySchema),
});

export const PlaylistMutationResultSchema = PlaylistDetailSchema;

export type ValidatedPlaylistSummary = z.infer<typeof PlaylistSummarySchema>;
export type ValidatedPlaylistDetail = z.infer<typeof PlaylistDetailSchema>;
