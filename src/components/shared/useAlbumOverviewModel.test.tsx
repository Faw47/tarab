import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import { useAlbumOverviewModel } from './useAlbumOverviewModel';

const { useCoverArtMock } = vi.hoisted(() => ({
  useCoverArtMock: vi.fn(),
}));

vi.mock('../../hooks/useCoverArt', () => ({
  useCoverArt: useCoverArtMock,
}));

const track = (id: string, year: number | null, duration: number): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year,
  duration,
  filePath: id + '.mp3',
  hasCoverArt: true,
  coverArtHash: 'hash-' + id,
  dateAdded: 1,
});

describe('useAlbumOverviewModel', () => {
  beforeEach(() => {
    useCoverArtMock.mockReset();
  });

  it('shares the first track, duration, release year, and cover-art fallback', () => {
    useCoverArtMock.mockReturnValue('cover-art://track-1/large');
    const tracks = [track('track-1', null, 90), track('track-2', 2024, 150)];

    const { result } = renderHook(() => useAlbumOverviewModel(tracks));

    expect(result.current.firstTrack).toBe(tracks[0]);
    expect(result.current.coverFromTrack).toBe('cover-art://track-1/large');
    expect(result.current.resolvedCoverArt).toBe('cover-art://track-1/large');
    expect(result.current.totalDuration).toBe(240);
    expect(result.current.releaseYear).toBe(2024);
  });

  it('normalizes a missing cover-art hook result and prefers an explicit cover', () => {
    useCoverArtMock.mockReturnValue(null);
    const tracks = [track('track-1', 2020, 10)];

    const { result } = renderHook(() => useAlbumOverviewModel(tracks, 'provided-cover'));

    expect(result.current.coverFromTrack).toBeNull();
    expect(result.current.resolvedCoverArt).toBe('provided-cover');

    const { result: missingResult } = renderHook(() => useAlbumOverviewModel(tracks));
    expect(missingResult.current.resolvedCoverArt).toBeUndefined();
  });
});
