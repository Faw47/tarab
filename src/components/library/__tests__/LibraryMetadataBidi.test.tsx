import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { LibraryAlbumsList } from '../LibraryAlbumsList';
import { LibraryArtistsList } from '../LibraryArtistsList';
import { LibraryTracksList } from '../LibraryTracksList';

vi.mock('../../shared/CoverArtImage', () => ({ CoverArtImage: () => null }));
vi.mock('../../shared/VirtualizedList', () => ({
  VirtualizedList: ({
    items,
    renderItem,
  }: {
    items: unknown[];
    renderItem: (item: unknown, index: number) => ReactNode;
  }) => <>{items.map(renderItem)}</>,
}));
const track: Track = {
  id: 'arabic',
  filePath: '/music/song.mp3',
  title: 'أغنية 2026 (Live)',
  artist: 'فيروز',
  album: 'Live أهواك (2026)',
  year: 2026,
  duration: 60,
  hasCoverArt: false,
  dateAdded: 0,
};
const assertDirection = (text: string) => {
  for (const label of screen.getAllByText(text)) expect(label).toHaveAttribute('dir', 'auto');
};
describe.each([false, true])('library metadata direction (neo=%s)', (isNeo) => {
  it('isolates track title, artist and album text', () => {
    render(
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
        formatSize={() => '1 MB'}
        getFormatLabel={() => 'MP3'}
        isLyricsMatch={false}
        getLyricsMatchLine={null}
        onRangeChange={vi.fn()}
        isNeo={isNeo}
      />,
    );
    assertDirection(track.title);
    assertDirection(track.artist);
    assertDirection(track.album);
  });
  it('isolates album names and both artist labels', () => {
    render(
      <LibraryAlbumsList
        albums={[{ track, count: 1 }]}
        searchQuery=""
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        isNeo={isNeo}
      />,
    );
    assertDirection(track.album);
    assertDirection(track.artist);
  });
  it('isolates artist names', () => {
    render(
      <LibraryArtistsList
        artists={[{ artist: track.artist, tracks: [track], count: 1 }]}
        searchQuery=""
        onOpen={vi.fn()}
        onPlay={vi.fn()}
        isNeo={isNeo}
      />,
    );
    assertDirection(track.artist);
  });
});
