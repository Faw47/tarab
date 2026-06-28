import { z } from 'zod';
import { PlaylistTypeSchema } from '../../../lib/validation/playlist';

export const SmartRuleKindSchema = z.enum([
  'RecentlyAdded',
  'MostPlayed',
  'TopRated',
  'ByArtist',
  'ByAlbum',
  'ByYear',
  'LongerThan',
  'ShorterThan',
]);

export const PlaylistEditorFormSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
    playlistType: PlaylistTypeSchema,
    folderPath: z.string().optional(),
    ruleKind: SmartRuleKindSchema,
    ruleValues: z.record(z.string(), z.string()),
  })
  .refine(
    (data) => {
      if (
        data.playlistType === 'FolderSync' &&
        (!data.folderPath || data.folderPath.trim() === '')
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'Folder path is required for folder sync playlists',
      path: ['folderPath'],
    },
  )
  .refine(
    (data) => {
      if (data.playlistType === 'Smart') {
        if (
          data.ruleKind === 'ByArtist' &&
          (!data.ruleValues.artist || data.ruleValues.artist.trim() === '')
        )
          return false;
        if (
          data.ruleKind === 'ByAlbum' &&
          (!data.ruleValues.album || data.ruleValues.album.trim() === '')
        )
          return false;
      }
      return true;
    },
    {
      message: 'Required rule value is missing',
      path: ['ruleValues'],
    },
  );

export type PlaylistEditorFormValues = z.infer<typeof PlaylistEditorFormSchema>;
