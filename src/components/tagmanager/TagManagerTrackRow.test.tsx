import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import { TagManagerTrackRow } from './TagManagerTrackRow';

vi.mock('../shared/CoverArtImage', () => ({
  CoverArtImage: () => null,
}));

const track: Track = {
  id: 'track-1',
  title: 'Midnight Transit',
  artist: 'Nour Ensemble',
  albumArtist: null,
  album: 'Night Routes',
  year: 2024,
  duration: 193,
  filePath: 'C:/Music/Night Routes/Midnight Transit.flac',
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
};

describe('TagManagerTrackRow', () => {
  it('keeps artist and album context available as compact mobile metadata', () => {
    render(
      <TagManagerTrackRow
        track={track}
        index={0}
        height={52}
        isSelected={false}
        isFocused={false}
        onSelect={vi.fn()}
        onContextMenu={vi.fn()}
        onReplaceSelection={vi.fn()}
      />,
    );

    expect(screen.getByText('Nour Ensemble / Night Routes')).toHaveClass('tag-manager-mobile-meta');
  });
});
