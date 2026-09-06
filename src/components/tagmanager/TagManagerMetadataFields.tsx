import { clsx } from 'clsx';
import { Edit2, Image as ImageIcon, Trash2 } from 'lucide-react';
import type { TagInfo, Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { Input } from '../ui/Input';
import type { EditableTagValue, TagEditKey, TagEditState } from './tag-manager-mutations';

type CoverArtActionKind = 'none' | 'set' | 'remove';

interface TagManagerMetadataFieldsProps {
  selectedTracks: Track[];
  originalTags: TagInfo | null;
  edited: TagEditState;
  applyFields: Record<TagEditKey, boolean>;
  isMulti: boolean;
  showTotalDiscs: boolean;
  coverArtPreview: string | null;
  coverArtActionKind: CoverArtActionKind;
  onCoverArtChange: () => void | Promise<void>;
  onStageRemoveCoverArt: () => void;
  onSetField: (key: TagEditKey, value: EditableTagValue) => void;
  onSetApplyField: (key: TagEditKey, on: boolean) => void;
}

const parseNumberOrNull = (raw: string): number | null | undefined => {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

export function TagManagerMetadataFields({
  selectedTracks,
  originalTags,
  edited,
  applyFields,
  isMulti,
  showTotalDiscs,
  coverArtPreview,
  coverArtActionKind,
  onCoverArtChange,
  onStageRemoveCoverArt,
  onSetField,
  onSetApplyField,
}: TagManagerMetadataFieldsProps) {
  const primaryTrack = selectedTracks[0];
  if (!primaryTrack) return null;

  const FieldLabel = ({ label, k }: { label: string; k: TagEditKey }) => {
    const applied = !isMulti || Boolean(applyFields[k]);

    return (
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={'tag-manager-' + k}
          className="text-xs uppercase text-text-subtle font-bold"
        >
          {label}
        </label>
        {isMulti && (
          <button
            type="button"
            onClick={() => onSetApplyField(k, !applied)}
            className={clsx(
              'px-2 py-1 rounded-lg text-xs font-bold border transition-colors',
              applied
                ? 'bg-primary/20 text-foreground border-primary/30'
                : 'bg-white/5 text-text-muted border-white/10 hover:bg-white/10',
            )}
            title={applied ? 'Applied to multi-edit' : 'Not applied to multi-edit'}
          >
            {applied ? 'APPLY' : 'SKIP'}
          </button>
        )}
      </div>
    );
  };

  const TextInput = ({ k, placeholder }: { k: TagEditKey; placeholder?: string }) => {
    const applied = !isMulti || Boolean(applyFields[k]);

    return (
      <Input
        id={'tag-manager-' + k}
        value={typeof edited[k] === 'string' ? edited[k] : (edited[k] ?? '')}
        onChange={(event) => onSetField(k, event.target.value)}
        onFocus={() => {
          if (isMulti && !applied) onSetApplyField(k, true);
        }}
        disabled={isMulti && !applied}
        className="w-full bg-white/5 border border-white/5 rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:bg-black focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        placeholder={isMulti ? '(Multiple)' : placeholder}
      />
    );
  };

  const NumberInput = ({ k, className }: { k: TagEditKey; className: string }) => {
    const applied = !isMulti || Boolean(applyFields[k]);
    const value = edited[k];

    return (
      <Input
        id={'tag-manager-' + k}
        type="number"
        value={typeof value === 'number' ? value : (value ?? '')}
        onChange={(event) => onSetField(k, parseNumberOrNull(event.target.value))}
        onFocus={() => {
          if (isMulti && !applied) onSetApplyField(k, true);
        }}
        disabled={isMulti && !applied}
        className={className}
      />
    );
  };

  return (
    <div className="tag-manager-metadata-fields space-y-6">
      <div className="flex gap-4">
        <div className="w-28 shrink-0 flex flex-col gap-2">
          <div className="w-28 h-28 rounded-xl overflow-hidden bg-black relative group border border-white/10">
            {coverArtPreview ? (
              <img src={coverArtPreview} className="w-full h-full object-cover" alt="Cover" />
            ) : coverArtActionKind === 'remove' ? (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-white/20" />
              </div>
            ) : selectedTracks.length === 1 &&
              (originalTags?.hasCoverArt ?? primaryTrack.hasCoverArt) ? (
              <CoverArtImage
                track={primaryTrack}
                className="w-full h-full"
                imgClassName="w-full h-full object-cover"
                roundedClassName=""
                iconClassName="w-8 h-8 text-white/20"
                alt="Cover"
                lazy={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-white/20" />
              </div>
            )}

            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onCoverArtChange}
                className="p-2 bg-white/10 rounded-full hover:bg-white/20"
                title="Change artwork"
              >
                <Edit2 className="w-4 h-4 text-white" />
              </button>
              <button
                type="button"
                onClick={onStageRemoveCoverArt}
                className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40"
                title="Remove artwork (saved on Save)"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onCoverArtChange}
            className="text-xs text-center text-text-secondary hover:text-white transition-colors"
          >
            Change Artwork...
          </button>
        </div>

        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <FieldLabel label="Title" k="title" />
            <TextInput k="title" placeholder="Title" />
          </div>
          <div className="space-y-1">
            <FieldLabel label="Artist" k="artist" />
            <TextInput k="artist" placeholder="Artist" />
          </div>
          <div className="space-y-1">
            <FieldLabel label="Album" k="album" />
            <TextInput k="album" placeholder="Album" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <FieldLabel label="A. Artist" k="albumArtist" />
          <TextInput k="albumArtist" placeholder="Album Artist" />
        </div>
        <div className="space-y-1">
          <FieldLabel label="Genre" k="genre" />
          <TextInput k="genre" placeholder="Genre" />
        </div>
        <div className="space-y-1">
          <FieldLabel label="Year" k="year" />
          <NumberInput
            k="year"
            className="w-full bg-white/5 border border-white/5 rounded-lg px-2 py-1.5 text-xs text-text-primary focus:bg-black focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
        <div
          className={clsx(
            'grid grid-cols-2 gap-2',
            showTotalDiscs ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
          )}
        >
          <div className="space-y-1">
            <FieldLabel label="Trk #" k="trackNumber" />
            <NumberInput
              k="trackNumber"
              className="w-full bg-black/40 border border-white/5 rounded px-2 py-1 text-xs text-center focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel label="Total" k="totalTracks" />
            <NumberInput
              k="totalTracks"
              className="w-full bg-black/40 border border-white/5 rounded px-2 py-1 text-xs text-center focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel label="Disc" k="discNumber" />
            <NumberInput
              k="discNumber"
              className="w-full bg-black/40 border border-white/5 rounded px-2 py-1 text-xs text-center focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          {showTotalDiscs && (
            <div className="space-y-1">
              <FieldLabel label="D. Total" k="totalDiscs" />
              <NumberInput
                k="totalDiscs"
                className="w-full bg-black/40 border border-white/5 rounded px-2 py-1 text-xs text-center focus:border-primary/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <FieldLabel label="Composer" k="composer" />
        <TextInput k="composer" placeholder="Composer" />
      </div>

      <div className="space-y-1">
        <FieldLabel label="Comment" k="comment" />
        <textarea
          id="tag-manager-comment"
          value={typeof edited.comment === 'string' ? edited.comment : (edited.comment ?? '')}
          onChange={(event) => onSetField('comment', event.target.value)}
          onFocus={() => {
            if (isMulti && !applyFields.comment) onSetApplyField('comment', true);
          }}
          disabled={isMulti && !applyFields.comment}
          rows={3}
          className="w-full bg-white/5 border border-white/5 rounded-lg px-2.5 py-2 text-xs text-text-primary focus:bg-black focus:border-primary/50 outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

TagManagerMetadataFields.displayName = 'TagManagerMetadataFields';
