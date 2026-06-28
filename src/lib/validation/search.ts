import { z } from 'zod';

export const SearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  duration: z.number(),
  filePath: z.string(),
  coverArtHash: z.string().nullable(),
  blurhash: z.string().nullable().optional(),
});

export const LyricsSearchResultSchema = SearchResultSchema.extend({
  matchedLine: z.string(),
  matchedLineIndex: z.number(),
});

export const SearchResultArraySchema = z.array(SearchResultSchema);
export const LyricsSearchResultArraySchema = z.array(LyricsSearchResultSchema);

export type ValidatedSearchResult = z.infer<typeof SearchResultSchema>;
export type ValidatedLyricsSearchResult = z.infer<typeof LyricsSearchResultSchema>;
