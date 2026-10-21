import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { AlbumTile, ArtistTile, TrackTile } from '../LibraryResultsOrchestrator';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock('../../shared/CoverArtImage', () => ({ CoverArtImage: () => null }));

const track: Track = {
  id: 't1',
  filePath: '/music/a.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  year: 2020,
  duration: 100,
  hasCoverArt: false,
  dateAdded: 0,
};

function expectNoNestedInteractive(container: HTMLElement) {
  // FE-21: no role="button" wrapper around the tile's own buttons, and the tile itself is not a
  // tab stop; the proxy button and the control buttons are siblings.
  expect(container.querySelector('[role="button"]')).toBeNull();
  expect(container.querySelector('article[tabindex]')).toBeNull();
  for (const button of Array.from(container.querySelectorAll('button'))) {
    expect(button.querySelector('button, a[href], [tabindex]')).toBeNull();
  }
}

describe.each([false, true])('library tiles (neo: %s) (FE-21)', (isNeo) => {
  it('track tile: proxy activation and a separate Play button', () => {
    const onPlayTrack = vi.fn();
    const onTrackSelect = vi.fn();
    const { container } = render(
      <TrackTile
        track={track}
        index={0}
        searchQuery=""
        isPlaying={false}
        isSelected
        onPlayTrack={onPlayTrack}
        onTrackSelect={onTrackSelect}
        onDragStart={vi.fn()}
        isLyricsMatch={false}
        matchedLyricLine={null}
        isNeo={isNeo}
      />,
    );
    expectNoNestedInteractive(container);

    // Enter or Space on the proxy produce a click; it does not also reach the tile's mouse handler.
    fireEvent.click(screen.getByRole('button', { name: 'Song by Artist, selected' }));
    if (isNeo) {
      expect(onTrackSelect).toHaveBeenCalledWith(track, false);
      expect(onPlayTrack).not.toHaveBeenCalled();
    } else {
      expect(onPlayTrack).toHaveBeenCalledWith(track);
      expect(onTrackSelect).not.toHaveBeenCalled();
    }

    onPlayTrack.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Play Song' }));
    expect(onPlayTrack).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('album tile (featured: %s): open and play are separate', (isFeatured) => {
    if (isNeo && isFeatured) return;
    const onOpen = vi.fn();
    const onPlay = vi.fn();
    const { container } = render(
      <AlbumTile
        album={{ track, count: 3 }}
        index={0}
        searchQuery=""
        onOpen={onOpen}
        onPlay={onPlay}
        isFeatured={isFeatured}
        isNeo={isNeo}
      />,
    );
    expectNoNestedInteractive(container);
    fireEvent.click(screen.getByRole('button', { name: 'Open album Album by Artist' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('artist tile: proxy opens the artist', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <ArtistTile
        artist={{ artist: 'Artist', tracks: [track], count: 1 }}
        index={0}
        searchQuery=""
        onOpen={onOpen}
        onPlay={vi.fn()}
        isNeo={isNeo}
      />,
    );
    expectNoNestedInteractive(container);
    fireEvent.click(screen.getByRole('button', { name: 'Open artist Artist' }));
    expect(onOpen).toHaveBeenCalledWith('Artist');
  });
});

describe('overlay buttons in neobrutalism', () => {
  it('opt out of the global neo button chrome, which painted them as opaque white chips', async () => {
    // Regression: neobrutalism.css gives every `button:not(.ghost)` a white fill, border and
    // shadow, so the full-tile overlays blanked every neo library tile and Home card.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, '../../../styles/neobrutalism.css'), 'utf8');
    expect(css).toMatch(/button:not\(\.ghost\)/);

    const { container } = render(
      <TrackTile
        track={track}
        index={0}
        searchQuery=""
        isPlaying={false}
        isSelected={false}
        onPlayTrack={vi.fn()}
        onDragStart={vi.fn()}
        isLyricsMatch={false}
        matchedLyricLine={null}
        isNeo
      />,
    );
    const proxy = container.querySelector('[data-tile-focus-proxy]');
    expect(proxy).toHaveClass('ghost', 'bg-transparent');
  });
});

describe('library count copy (LD-11)', () => {
  it('labels neo album and artist counts as tracks', () => {
    const onOpen = vi.fn();
    const onPlay = vi.fn();
    render(
      <AlbumTile
        album={{ track, count: 3 }}
        index={0}
        searchQuery=""
        onOpen={onOpen}
        onPlay={onPlay}
        isFeatured={false}
        isNeo
      />,
    );

    expect(screen.getByText('3 TRACKS')).toBeInTheDocument();
  });

  it('uses the singular track label for one item in a neo artist card', () => {
    render(
      <ArtistTile
        artist={{ artist: 'Artist', tracks: [track], count: 1 }}
        index={0}
        searchQuery=""
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        isNeo
      />,
    );

    expect(screen.getByText('1 TRACK')).toBeInTheDocument();
  });
});
