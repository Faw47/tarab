import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TagEditorMetadataForm } from './TagEditorMetadataForm';

describe('TagEditorMetadataForm labels', () => {
  it('associates standard metadata fields with their visible labels', () => {
    const setValue = vi.fn();
    const props: ComponentProps<typeof TagEditorMetadataForm> = {
      activeTab: 'standard',
      isBatchEdit: false,
      title: 'Song',
      setTitle: setValue,
      artist: 'Artist',
      setArtist: setValue,
      album: 'Album',
      setAlbum: setValue,
      albumArtist: 'Album Artist',
      setAlbumArtist: setValue,
      year: '2026',
      setYear: setValue,
      trackNumber: '1',
      setTrackNumber: setValue,
      discNumber: '1',
      setDiscNumber: setValue,
      genre: 'Genre',
      setGenre: setValue,
      composer: 'Composer',
      setComposer: setValue,
      comment: 'Comment',
      setComment: setValue,
      extendedFields: [],
      onAddExtendedField: vi.fn(),
      onUpdateExtendedField: vi.fn(),
      onRemoveExtendedField: vi.fn(),
    };

    render(<TagEditorMetadataForm {...props} />);

    expect(screen.getByLabelText('Title')).toHaveValue('Song');
    expect(screen.getByLabelText('Artist')).toHaveValue('Artist');
    expect(screen.getByLabelText('Album Artist')).toHaveValue('Album Artist');
    expect(screen.getByLabelText('Album')).toHaveValue('Album');
    expect(screen.getByLabelText('Genre')).toHaveValue('Genre');
    expect(screen.getByLabelText('Year')).toHaveValue(2026);
    expect(screen.getByLabelText('Track #')).toHaveValue(1);
    expect(screen.getByLabelText('Disc #')).toHaveValue(1);
    expect(screen.getByLabelText('Composer')).toHaveValue('Composer');
    expect(screen.getByLabelText('Comment')).toHaveValue('Comment');
  });
});
