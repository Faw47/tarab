import type { Track } from '../types';

const normalizePart = (value: string | null | undefined): string =>
  (value ?? '').trim().toLocaleLowerCase();

export const getAlbumArtist = (track: Pick<Track, 'artist' | 'albumArtist'>): string =>
  track.albumArtist?.trim() || track.artist;

export const getAlbumKey = (track: Pick<Track, 'album' | 'artist' | 'albumArtist'>): string =>
  `${normalizePart(track.album)}::${normalizePart(getAlbumArtist(track))}`;

export const getAlbumKeyFromParts = (album: string, artist: string): string =>
  `${normalizePart(album)}::${normalizePart(artist)}`;
