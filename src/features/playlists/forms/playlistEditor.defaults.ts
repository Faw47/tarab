import type { BackendSmartPlaylistRule, PlaylistType } from '../../../types';
import type { PlaylistEditorFormValues } from './playlistEditor.schema';

const DEFAULT_RULE_KIND = 'RecentlyAdded';

const toFiniteInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const toMinInteger = (value: string | undefined, fallback: number, min: number): number =>
  Math.max(min, toFiniteInteger(value, fallback));

const toRangeInteger = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => Math.min(max, Math.max(min, toFiniteInteger(value, fallback)));

export const parseRule = (
  rules?: BackendSmartPlaylistRule[],
): {
  kind: PlaylistEditorFormValues['ruleKind'];
  values: Record<string, string>;
} => {
  const first = rules?.[0];
  if (!first) {
    return { kind: DEFAULT_RULE_KIND, values: { days: '30' } };
  }

  if ('RecentlyAdded' in first) {
    return { kind: 'RecentlyAdded', values: { days: String(first.RecentlyAdded.days) } };
  }
  if ('MostPlayed' in first) {
    return { kind: 'MostPlayed', values: { minPlays: String(first.MostPlayed.min_plays) } };
  }
  if ('TopRated' in first) {
    return { kind: 'TopRated', values: { minRating: String(first.TopRated.min_rating) } };
  }
  if ('ByArtist' in first) {
    return { kind: 'ByArtist', values: { artist: first.ByArtist.artist } };
  }
  if ('ByAlbum' in first) {
    return { kind: 'ByAlbum', values: { album: first.ByAlbum.album } };
  }
  if ('ByYear' in first) {
    return {
      kind: 'ByYear',
      values: {
        startYear: String(first.ByYear.start_year),
        endYear: String(first.ByYear.end_year),
      },
    };
  }
  if ('LongerThan' in first) {
    return { kind: 'LongerThan', values: { seconds: String(first.LongerThan.seconds) } };
  }
  if ('ShorterThan' in first) {
    return { kind: 'ShorterThan', values: { seconds: String(first.ShorterThan.seconds) } };
  }

  return { kind: DEFAULT_RULE_KIND, values: { days: '30' } };
};

export const toBackendRule = (
  kind: PlaylistEditorFormValues['ruleKind'],
  values: Record<string, string>,
): BackendSmartPlaylistRule[] => {
  switch (kind) {
    case 'RecentlyAdded':
      return [{ RecentlyAdded: { days: toMinInteger(values.days, 30, 1) } }];
    case 'MostPlayed':
      return [{ MostPlayed: { min_plays: toMinInteger(values.minPlays, 1, 1) } }];
    case 'TopRated':
      return [{ TopRated: { min_rating: toRangeInteger(values.minRating, 4, 0, 5) } }];
    case 'ByArtist':
      return [{ ByArtist: { artist: values.artist || '' } }];
    case 'ByAlbum':
      return [{ ByAlbum: { album: values.album || '' } }];
    case 'ByYear':
      return [
        {
          ByYear: {
            start_year: toMinInteger(values.startYear, 0, 0),
            end_year: toMinInteger(values.endYear, 9999, 0),
          },
        },
      ];
    case 'LongerThan':
      return [{ LongerThan: { seconds: toMinInteger(values.seconds, 0, 0) } }];
    case 'ShorterThan':
      return [{ ShorterThan: { seconds: toMinInteger(values.seconds, 0, 0) } }];
    default:
      return [{ RecentlyAdded: { days: 30 } }];
  }
};

export const getPlaylistEditorDefaults = (initial?: {
  name?: string;
  playlistType?: PlaylistType;
  smartRules?: BackendSmartPlaylistRule[];
  folderPath?: string;
}): PlaylistEditorFormValues => {
  const parsedRule = parseRule(initial?.smartRules);
  return {
    name: initial?.name ?? '',
    playlistType: initial?.playlistType ?? 'Manual',
    folderPath: initial?.folderPath ?? '',
    ruleKind: parsedRule.kind,
    ruleValues: parsedRule.values,
  };
};
