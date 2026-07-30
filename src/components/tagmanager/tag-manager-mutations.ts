import type { TagClearField, TagInfo, TagUpdate } from '../../types';

export type TagEditKey = Extract<
  keyof TagInfo,
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'year'
  | 'genre'
  | 'trackNumber'
  | 'totalTracks'
  | 'discNumber'
  | 'totalDiscs'
  | 'composer'
  | 'comment'
>;

export type EditableTagValue = string | number | null | undefined;
export type TagEditState = Partial<Record<TagEditKey, EditableTagValue>>;
export type PendingTagUpdate = Partial<Record<TagEditKey, EditableTagValue>> &
  Pick<TagUpdate, 'coverArtBase64' | 'coverArtMime' | 'clearFields'>;

export const TAG_FIELDS: Array<{
  key: TagEditKey;
  label: string;
  kind: 'text' | 'number' | 'textarea';
  placeholder?: string;
}> = [
  { key: 'title', label: 'Title', kind: 'text', placeholder: 'Title' },
  { key: 'artist', label: 'Artist', kind: 'text', placeholder: 'Artist' },
  { key: 'album', label: 'Album', kind: 'text', placeholder: 'Album' },
  { key: 'albumArtist', label: 'Album Artist', kind: 'text', placeholder: 'Album Artist' },
  { key: 'genre', label: 'Genre', kind: 'text', placeholder: 'Genre' },
  { key: 'year', label: 'Year', kind: 'number', placeholder: 'Year' },
  { key: 'trackNumber', label: 'Track #', kind: 'number', placeholder: '#' },
  { key: 'totalTracks', label: 'Total Tracks', kind: 'number', placeholder: 'Total' },
  { key: 'discNumber', label: 'Disc #', kind: 'number', placeholder: 'Disc' },
  { key: 'totalDiscs', label: 'Total Discs', kind: 'number', placeholder: 'Total' },
  { key: 'composer', label: 'Composer', kind: 'text', placeholder: 'Composer' },
  { key: 'comment', label: 'Comment', kind: 'textarea', placeholder: 'Comment' },
];

export const getEditableTagValue = (tags: TagInfo, key: TagEditKey): EditableTagValue => tags[key];

export const pickEditableTags = (tags: TagInfo): TagEditState => {
  const next: TagEditState = {};
  for (const field of TAG_FIELDS) next[field.key] = tags[field.key];
  return next;
};

const addClearField = (updates: TagUpdate | PendingTagUpdate, key: TagClearField) => {
  updates.clearFields = updates.clearFields?.includes(key)
    ? updates.clearFields
    : [...(updates.clearFields ?? []), key];
};

export const setTagUpdateField = (
  updates: TagUpdate | PendingTagUpdate,
  key: TagEditKey,
  value: EditableTagValue,
) => {
  if (value === null || value === undefined) {
    updates[key] = null;
    addClearField(updates, key);
    return;
  }
  updates[key] = value;
};

export const tagValuesEqual = (left: EditableTagValue, right: EditableTagValue): boolean => {
  if (left == null && right == null) return true;
  if (typeof left === 'number' || typeof right === 'number') return left === right;
  return String(left ?? '') === String(right ?? '');
};

export const tagEditStateToUpdate = (state: TagEditState): TagUpdate => {
  const updates: TagUpdate = {};
  for (const field of TAG_FIELDS) {
    if (field.key in state) setTagUpdateField(updates, field.key, state[field.key]);
  }
  return updates;
};

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
