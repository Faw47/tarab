import type { Track } from '../types';

const parseLeadingNumber = (value: string): number | null => {
  const match = value.match(/^\s*(\d{1,3})\b/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const getBaseName = (filePath: string): string => {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
};

const stripExtension = (value: string): string => value.replace(/\.[^/.]+$/, '');

const getTrackOrder = (track: Track): number | null => {
  if (typeof track.trackNumber === 'number' && Number.isFinite(track.trackNumber)) {
    return track.trackNumber;
  }

  const fromTitle = parseLeadingNumber(track.title);
  if (fromTitle !== null) return fromTitle;
  const baseName = stripExtension(getBaseName(track.filePath));
  return parseLeadingNumber(baseName);
};

const getDiscOrder = (track: Track): number => {
  if (typeof track.discNumber === 'number' && Number.isFinite(track.discNumber)) {
    return track.discNumber;
  }
  return 1;
};

export const sortAlbumTracks = (tracks: Track[]): Track[] =>
  [...tracks].sort((a, b) => {
    const discOrder = getDiscOrder(a) - getDiscOrder(b);
    if (discOrder !== 0) return discOrder;

    const aNum = getTrackOrder(a);
    const bNum = getTrackOrder(b);
    if (aNum !== null && bNum !== null && aNum !== bNum) {
      return aNum - bNum;
    }
    if (aNum !== null && bNum === null) return -1;
    if (aNum === null && bNum !== null) return 1;
    const titleOrder = a.title.localeCompare(b.title);
    if (titleOrder !== 0) return titleOrder;
    return a.filePath.localeCompare(b.filePath);
  });
