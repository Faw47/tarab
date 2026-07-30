import { Plus, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '../ui/button';
import { IconButton } from '../ui/IconButton';

interface TagEditorMetadataFormProps {
  activeTab: 'standard' | 'extended' | 'lyrics';
  isBatchEdit: boolean;
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  artist: string;
  setArtist: Dispatch<SetStateAction<string>>;
  album: string;
  setAlbum: Dispatch<SetStateAction<string>>;
  albumArtist: string;
  setAlbumArtist: Dispatch<SetStateAction<string>>;
  year: string;
  setYear: Dispatch<SetStateAction<string>>;
  trackNumber: string;
  setTrackNumber: Dispatch<SetStateAction<string>>;
  discNumber: string;
  setDiscNumber: Dispatch<SetStateAction<string>>;
  genre: string;
  setGenre: Dispatch<SetStateAction<string>>;
  composer: string;
  setComposer: Dispatch<SetStateAction<string>>;
  comment: string;
  setComment: Dispatch<SetStateAction<string>>;
  extendedFields: Array<{ key: string; value: string }>;
  onAddExtendedField: () => void;
  onUpdateExtendedField: (index: number, field: 'key' | 'value', value: string) => void;
  onRemoveExtendedField: (index: number) => void;
}

export function TagEditorMetadataForm({
  activeTab,
  isBatchEdit,
  title,
  setTitle,
  artist,
  setArtist,
  album,
  setAlbum,
  albumArtist,
  setAlbumArtist,
  year,
  setYear,
  trackNumber,
  setTrackNumber,
  discNumber,
  setDiscNumber,
  genre,
  setGenre,
  composer,
  setComposer,
  comment,
  setComment,
  extendedFields,
  onAddExtendedField,
  onUpdateExtendedField,
  onRemoveExtendedField,
}: TagEditorMetadataFormProps) {
  const handleAddExtendedField = onAddExtendedField;
  const handleUpdateExtendedField = onUpdateExtendedField;
  const handleRemoveExtendedField = onRemoveExtendedField;

  return (
    <>
      {activeTab === 'standard' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-text-secondary mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isBatchEdit ? 'Leave empty to keep original' : 'Track title'}
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Artist</label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder={isBatchEdit ? 'Leave empty to keep original' : 'Artist name'}
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Album Artist</label>
              <input
                type="text"
                value={albumArtist}
                onChange={(e) => setAlbumArtist(e.target.value)}
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-text-secondary mb-1">Album</label>
              <input
                type="text"
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder={isBatchEdit ? 'Leave empty to keep original' : 'Album name'}
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Genre</label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="YYYY"
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Track #</label>
              <input
                type="number"
                value={trackNumber}
                onChange={(e) => setTrackNumber(e.target.value)}
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Disc #</label>
              <input
                type="number"
                value={discNumber}
                onChange={(e) => setDiscNumber(e.target.value)}
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Composer</label>
              <input
                type="text"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Comment</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
          </div>
        </>
      )}

      {activeTab === 'extended' && (
        <div className="panel rounded-2xl p-4 border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">Extended tags</p>
              <p className="text-xs text-text-muted">Vorbis / ID3v2 custom fields</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddExtendedField}
              className="flex items-center gap-2 rounded-full text-text-primary hover:text-white text-sm h-8 px-3 hover:bg-white/10"
            >
              <Plus className="w-4 h-4" />
              Add field
            </Button>
          </div>
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-text-subtle text-xs font-bold uppercase">
                <tr>
                  <th className="p-3 w-1/3">Field</th>
                  <th className="p-3">Value</th>
                  <th className="p-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {extendedFields.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-text-muted text-sm">
                      No extended tags found.
                    </td>
                  </tr>
                ) : (
                  extendedFields.map((tag, i) => (
                    <tr key={`${tag.key}-${i}`} className="group hover:bg-white/5">
                      <td className="p-3">
                        <input
                          value={tag.key}
                          onChange={(e) => handleUpdateExtendedField(i, 'key', e.target.value)}
                          placeholder="FIELD NAME"
                          className="w-full bg-transparent border border-white/10 rounded-lg px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          value={tag.value}
                          onChange={(e) => handleUpdateExtendedField(i, 'value', e.target.value)}
                          placeholder="Value"
                          className="w-full bg-transparent border border-white/10 rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </td>
                      <td className="p-3 text-right">
                        <IconButton
                          className="p-1 text-text-muted hover:text-red-400 hover:bg-red-950/20 rounded-full"
                          onClick={() => handleRemoveExtendedField(i)}
                          aria-label="Remove field"
                        >
                          <X className="w-4 h-4" />
                        </IconButton>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-muted">
            These fields save alongside standard tags. Leave blank to keep current values.
          </p>
        </div>
      )}
    </>
  );
}
