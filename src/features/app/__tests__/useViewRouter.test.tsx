import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Track } from '../../../types';
import type { AlbumDetailsState } from '../app-state-types';
import { useViewRouter } from '../useViewRouter';

const track: Track = {
  id: 'track-1',
  title: 'Track 1',
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: '/music/track-1.mp3',
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
};

const albumDetails: AlbumDetailsState = {
  album: 'Album',
  artist: 'Artist',
  tracks: [track],
};

describe('useViewRouter', () => {
  it('pushes and pops views', () => {
    const { result } = renderHook(() => useViewRouter('home'));

    act(() => result.current.navigate('library'));
    act(() => result.current.navigate('queue'));

    expect(result.current.currentView).toBe('queue');
    expect(result.current.canGoBack).toBe(true);

    act(() => result.current.goBack());
    expect(result.current.currentView).toBe('library');

    act(() => result.current.goBack());
    expect(result.current.currentView).toBe('home');
    expect(result.current.canGoBack).toBe(false);
  });

  it('replaces same non-album view instead of growing history', () => {
    const { result } = renderHook(() => useViewRouter('home'));

    act(() => result.current.navigate('library'));
    act(() => result.current.navigate('library'));
    act(() => result.current.goBack());

    expect(result.current.currentView).toBe('home');
  });

  it('stores album details on album entries', () => {
    const { result } = renderHook(() => useViewRouter('home'));

    act(() => result.current.navigate('album', { albumDetails }));

    expect(result.current.currentView).toBe('album');
    expect(result.current.albumDetails).toEqual(albumDetails);
  });

  it('returns to library when album details are cleared from an album view', () => {
    const { result } = renderHook(() => useViewRouter('home'));

    act(() => result.current.navigate('album', { albumDetails }));
    act(() => result.current.setAlbumDetailsForCurrentView(null));

    expect(result.current.currentView).toBe('library');
    expect(result.current.albumDetails).toBeNull();
  });

  it('caps history depth', () => {
    const { result } = renderHook(() => useViewRouter('home'));

    for (let index = 0; index < 30; index += 1) {
      act(() => result.current.navigate(index % 2 === 0 ? 'library' : 'queue'));
    }

    for (let index = 0; index < 30; index += 1) {
      act(() => result.current.goBack());
    }

    expect(result.current.currentView).toBe('queue');
    expect(result.current.canGoBack).toBe(false);
  });
});
