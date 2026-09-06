import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';
import type { TagInfo, Track } from '../../types';
import { TagManagerMetadataFields } from './TagManagerMetadataFields';
import {
  pickEditableTags,
  TAG_FIELDS,
  type TagEditKey,
  type TagEditState,
} from './tag-manager-mutations';

const track: Track = {
  id: 'metadata-story-track',
  title: 'Midnight Transit',
  artist: 'Nour Ensemble',
  albumArtist: 'Nour Ensemble',
  album: 'Night Routes',
  year: 2024,
  trackNumber: 3,
  discNumber: 1,
  duration: 238,
  filePath: 'C:/Music/Nour Ensemble/Night Routes/03 - Midnight Transit.flac',
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1_735_689_600_000,
  fileFormat: 'FLAC',
  bitrate: 1411,
  sampleRate: 44_100,
};

const originalTags: TagInfo = {
  title: track.title,
  artist: track.artist,
  album: track.album,
  albumArtist: track.albumArtist ?? undefined,
  year: track.year ?? undefined,
  trackNumber: track.trackNumber ?? undefined,
  totalTracks: 10,
  discNumber: track.discNumber ?? undefined,
  totalDiscs: 2,
  genre: 'Ambient',
  composer: 'Nour Ensemble',
  comment: 'Storybook metadata state',
  hasCoverArt: false,
  filePath: track.filePath,
  fileFormat: 'FLAC',
  bitrate: 1411,
  sampleRate: 44_100,
  durationSecs: track.duration,
};

function MetadataHarness({ multi = false }: { multi?: boolean }) {
  const [edited, setEdited] = useState<TagEditState>(() => pickEditableTags(originalTags));
  const [applyFields, setApplyFields] = useState<Record<TagEditKey, boolean>>(
    () =>
      Object.fromEntries(TAG_FIELDS.map((field) => [field.key, multi])) as Record<
        TagEditKey,
        boolean
      >,
  );

  return (
    <TagManagerMetadataFields
      selectedTracks={multi ? [track, { ...track, id: 'metadata-story-track-2' }] : [track]}
      originalTags={multi ? null : originalTags}
      edited={edited}
      applyFields={applyFields}
      isMulti={multi}
      showTotalDiscs
      coverArtPreview={null}
      coverArtActionKind="none"
      onCoverArtChange={fn()}
      onStageRemoveCoverArt={fn()}
      onSetField={(key, value) => setEdited((current) => ({ ...current, [key]: value }))}
      onSetApplyField={(key, value) => setApplyFields((current) => ({ ...current, [key]: value }))}
    />
  );
}

const meta = {
  title: 'Tag Manager/MetadataFields',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => (
    <div className="mx-auto min-h-screen max-w-2xl bg-[var(--background)] p-6 text-[var(--foreground)]">
      <MetadataHarness />
    </div>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleTrack: Story = {};

export const MultiTrackApply: Story = {
  render: () => (
    <div className="mx-auto min-h-screen max-w-2xl bg-[var(--background)] p-6 text-[var(--foreground)]">
      <MetadataHarness multi />
    </div>
  ),
};

export const NeobrutalismMultiTrack: Story = {
  ...MultiTrackApply,
  globals: {
    theme: 'neobrutalism',
  },
};
