import { fireEvent, render, within } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { LibraryAlbumsList } from '../LibraryAlbumsList';
import { LibraryArtistsList } from '../LibraryArtistsList';
import { LibraryTracksList } from '../LibraryTracksList';

vi.mock('../../shared/VirtualizedList', () => ({
  VirtualizedList: ({
    items,
    renderItem,
    containerProps,
  }: {
    items: unknown[];
    renderItem: (item: unknown, index: number) => ReactNode;
    containerProps?: HTMLAttributes<HTMLDivElement>;
  }) => <div {...containerProps}>{items.map((item, index) => renderItem(item, index))}</div>,
}));

vi.mock('../../shared/CoverArtImage', () => ({
  CoverArtImage: () => <div aria-hidden="true" />,
}));

const track: Track = {
  id: 'track-1',
  title: 'Track',
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: 'C:/Music/track.mp3',
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
};

describe('library list row keyboard activation', () => {
  it('opens album and artist rows with Enter or Space', () => {
    const openAlbum = vi.fn();
    const albumView = render(
      <LibraryAlbumsList
        albums={[{ track, count: 1 }]}
        searchQuery=""
        onOpen={openAlbum}
        onPlay={vi.fn()}
      />,
    );
    const albumRow = albumView.container.querySelector<HTMLElement>('[role="group"][tabindex="0"]');
    expect(albumRow).not.toBeNull();
    expect(albumRow).toHaveClass('library-list-row--albums');
    fireEvent.keyDown(albumRow!, { key: 'Enter' });
    expect(openAlbum).toHaveBeenCalledWith(track);
    albumView.unmount();

    const openArtist = vi.fn();
    const artistView = render(
      <LibraryArtistsList
        artists={[{ artist: 'Artist', tracks: [track], count: 1 }]}
        searchQuery=""
        onOpen={openArtist}
        onPlay={vi.fn()}
      />,
    );
    const artistRow = artistView.container.querySelector<HTMLElement>(
      '[role="group"][tabindex="0"]',
    );
    expect(artistRow).not.toBeNull();
    expect(artistRow).toHaveClass('library-list-row--artists');
    fireEvent.keyDown(artistRow!, { key: ' ' });
    expect(openArtist).toHaveBeenCalledWith('Artist');
  });

  it('passes the complete clicked track to file info', () => {
    const onShowFileInfo = vi.fn();
    const hydratedTrack = {
      ...track,
      filePath: 'C:/Music/hydrated.flac',
      fileFormat: 'flac',
      bitrate: 1411,
      sampleRate: 96_000,
      fileSize: 4_096,
    };

    const view = render(
      <LibraryTracksList
        tracks={[hydratedTrack]}
        searchQuery=""
        activeTrackId={null}
        isPlaying={false}
        selectedTrackIds={[]}
        onPlayTrack={vi.fn()}
        onRowClick={vi.fn()}
        onShowFileInfo={onShowFileInfo}
        onDragStart={vi.fn()}
        formatSize={() => '4 KB'}
        getFormatLabel={() => 'FLAC'}
        isLyricsMatch={false}
        getLyricsMatchLine={null}
        onRangeChange={vi.fn()}
      />,
    );

    fireEvent.click(view.getByRole('button', { name: 'Open info for Track' }));
    expect(onShowFileInfo).toHaveBeenCalledWith(hydratedTrack);
  });

  it('exposes track selection through a keyboard listbox option', () => {
    const view = render(
      <LibraryTracksList
        tracks={[track]}
        searchQuery=""
        activeTrackId={null}
        isPlaying={false}
        selectedTrackIds={[]}
        onPlayTrack={vi.fn()}
        onRowClick={vi.fn()}
        onShowFileInfo={vi.fn()}
        onDragStart={vi.fn()}
        formatSize={() => '4 KB'}
        getFormatLabel={() => 'FLAC'}
        isLyricsMatch={false}
        getLyricsMatchLine={null}
        onRangeChange={vi.fn()}
      />,
    );

    const list = view.getByRole('listbox', { name: 'Library tracks' });
    expect(list).toHaveAttribute('aria-multiselectable', 'true');
    const option = within(list).getByRole('option', { name: 'Track by Artist' });
    expect(option).toHaveClass('library-list-row--tracks');
    expect(option).toHaveAttribute('aria-selected', 'false');
    expect(option).toHaveAttribute('data-virtual-list-focus-target');
    expect(option.querySelector('.library-track-cover-play')).not.toBeNull();
    expect(option.querySelector('.library-track-actions-play')).not.toBeNull();
  });
  it('highlights a case-variant playing artist in the Neo list', () => {
    const view = render(
      <LibraryArtistsList
        artists={[{ artist: 'Artist', tracks: [track], count: 1 }]}
        searchQuery=""
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        isNeo
        currentTrack={{ ...track, artist: 'ARTIST' }}
        isPlaying
      />,
    );

    const row = view.container.querySelector<HTMLElement>('[data-virtual-list-focus-target]');
    expect(row).toHaveClass('bg-[var(--signal-play)]');
  });

  it('highlights a case-variant playing album in the Neo list', () => {
    const view = render(
      <LibraryAlbumsList
        albums={[{ track, count: 1 }]}
        searchQuery=""
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        isNeo
        currentTrack={{ ...track, album: 'ALBUM' }}
        isPlaying
      />,
    );

    const row = view.container.querySelector<HTMLElement>('[data-virtual-list-focus-target]');
    expect(row).toHaveClass('bg-[var(--signal-play)]');
  });
});
