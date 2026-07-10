import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { useAppShellPalette } from '../useAppShellPalette';

const mocks = vi.hoisted(() => ({
  useCoverArt: vi.fn(
    (
      filePath: string | undefined,
      _hasCoverArt: boolean | undefined,
      _enabled: boolean,
      size: string,
    ) => (filePath ? `${filePath}:${size}` : null),
  ),
  useReactivePalette: vi.fn(() => ({
    shellBlobA: '#111111',
    shellBlobB: '#222222',
    liquidColors: { b3: '#333333' },
    heroAccent: '#abcdef',
    primaryRgb: '171, 205, 239',
    heroGlow: 'rgba(171,205,239,0.5)',
    surfaceTint: 'rgba(171,205,239,0.1)',
    textContrastBias: 1,
    secondaryAccent: '#fedcba',
  })),
}));

vi.mock('../../../hooks/useCoverArt', () => ({
  useCoverArt: mocks.useCoverArt,
}));

vi.mock('../../../hooks/useReactivePalette', () => ({
  useReactivePalette: mocks.useReactivePalette,
}));

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: `/music/${id}.flac`,
  hasCoverArt: true,
  coverArtHash: `${id}-hash`,
  dateAdded: 1,
});

describe('useAppShellPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives the home shell palette and ambient art from the current track', () => {
    const currentTrack = makeTrack('current');
    const { result } = renderHook(() =>
      useAppShellPalette({
        currentTrack,
        currentView: 'home',
        albumDetails: null,
      }),
    );

    expect(result.current.isAlbumView).toBe(false);
    expect(result.current.homeAmbientCoverUrl).toBe('/music/current.flac:large');
    expect(mocks.useReactivePalette).toHaveBeenCalledWith({
      filePath: '/music/current.flac',
      coverArtUrl: '/music/current.flac:small',
    });
    expect(result.current.shellVars).toMatchObject({
      '--hero-accent': '#abcdef',
      '--hero-accent-rgb': '171 205 239',
      '--color-accent': '#fedcba',
    });
  });

  it('uses the open album first track for album ambient art and palette', () => {
    const currentTrack = makeTrack('current');
    const albumTrack = makeTrack('album-track');
    const { result } = renderHook(() =>
      useAppShellPalette({
        currentTrack,
        currentView: 'album',
        albumDetails: {
          album: 'Album',
          artist: 'Artist',
          tracks: [albumTrack],
        },
      }),
    );

    expect(result.current.isAlbumView).toBe(true);
    expect(result.current.homeAmbientCoverUrl).toBe('/music/album-track.flac:large');
    expect(mocks.useReactivePalette).toHaveBeenCalledWith({
      filePath: '/music/album-track.flac',
      coverArtUrl: '/music/album-track.flac:small',
    });
  });
});
