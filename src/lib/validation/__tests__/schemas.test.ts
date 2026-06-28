import { describe, expect, it } from 'vitest';
import { DbTrackSchema } from '../library';
import { PlaylistSummarySchema } from '../playlist';
import { LyricsSearchResultSchema, SearchResultSchema } from '../search';
import { SettingsSchema } from '../settings';

describe('Zod Schemas', () => {
  describe('PlaylistSummarySchema', () => {
    it('should successfully parse a valid playlist summary', () => {
      const validPlaylist = {
        id: 'playlist-1',
        name: 'My Playlist',
        playlistType: 'Manual',
        trackCount: 10,
        missingCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = PlaylistSummarySchema.safeParse(validPlaylist);
      expect(result.success).toBe(true);
    });

    it('accepts null smartRules and folderPath from backend JSON', () => {
      const fromBackend = {
        id: 'p1',
        name: 'Mix',
        playlistType: 'Manual',
        trackCount: 0,
        missingCount: 0,
        smartRules: null,
        folderPath: null,
        createdAt: 1,
        updatedAt: 2,
      };

      const result = PlaylistSummarySchema.safeParse(fromBackend);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.smartRules).toBeUndefined();
        expect(result.data.folderPath).toBeUndefined();
      }
    });

    it('should fail on invalid playlist type', () => {
      const invalidPlaylist = {
        id: 'playlist-1',
        name: 'My Playlist',
        playlistType: 'InvalidType',
        trackCount: 10,
        missingCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = PlaylistSummarySchema.safeParse(invalidPlaylist);
      expect(result.success).toBe(false);
    });
  });

  describe('SettingsSchema', () => {
    it('should successfully parse valid settings', () => {
      const validSettings = {
        theme: 'liquid-glass',
        lyricsEnabled: true,
        volume: 0.8, // Should be ignored/filtered if not in schema or allowed as partial
      };

      const result = SettingsSchema.safeParse(validSettings);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.theme).toBe('liquid-glass');
      }
    });
  });

  describe('DbTrackSchema', () => {
    it('parses a valid db track payload', () => {
      const validDbTrack = {
        id: '/music/song.mp3',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        year: 2024,
        duration: 245,
        filePath: '/music/song.mp3',
        hasCoverArt: true,
        coverArtHash: 'abc123',
        dateAdded: Date.now(),
        playCount: 3,
        lastPlayed: Date.now(),
        rating: 4,
      };

      const result = DbTrackSchema.safeParse(validDbTrack);
      expect(result.success).toBe(true);
    });
  });

  describe('Search Schemas', () => {
    it('parses metadata search results', () => {
      const result = SearchResultSchema.safeParse({
        id: 'track-1',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        duration: 120,
        filePath: '/music/song.mp3',
        coverArtHash: null,
      });
      expect(result.success).toBe(true);
    });

    it('parses lyrics search results', () => {
      const result = LyricsSearchResultSchema.safeParse({
        id: 'track-1',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        duration: 120,
        filePath: '/music/song.mp3',
        coverArtHash: null,
        matchedLine: 'line text',
        matchedLineIndex: 2,
      });
      expect(result.success).toBe(true);
    });
  });
});
