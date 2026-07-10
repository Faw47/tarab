import { clsx } from 'clsx';
import {
  Clipboard,
  ClipboardCheck,
  Image,
  Loader2,
  Plus,
  Save,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useCoverArt } from '../../hooks/useCoverArt';
import { reportError } from '../../lib/report-error';
import {
  getCoverArtData,
  getLyricsForTrack,
  readFullTags,
  readImageAsBase64,
  removeCoverArt,
  selectImageFile,
  writeLyricsForTrack,
  writeTags,
  writeTagsBatch,
} from '../../lib/tauri-commands';
import { refreshTracksByFilePaths } from '../../lib/track-refresh';
import { clipboard } from '../../platform/clipboard';
import { useMetadataClipboardStore } from '../../store/metadata-clipboard-store';
import type { TagClearField, TagInfo, TagUpdate, Track } from '../../types';
import { MetadataClipboard } from '../metadata/MetadataClipboard';
import { Button } from '../ui/button';
import { IconButton } from '../ui/IconButton';
import { LyricsEditor } from './LyricsEditor';

const deriveTagsFromPath = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const filename = parts[parts.length - 1] ?? '';
  const basename = filename.replace(/\.[^/.]+$/, '');
  let derivedArtist = '';
  let derivedTitle = basename;
  if (basename.includes(' - ')) {
    const [artistPart, titlePart] = basename.split(' - ');
    derivedArtist = artistPart?.trim() ?? '';
    derivedTitle = titlePart?.trim() ?? derivedTitle;
  }
  const derivedAlbum = parts.length > 1 ? (parts[parts.length - 2] ?? '') : '';
  return {
    title: derivedTitle,
    artist: derivedArtist,
    album: derivedAlbum,
  };
};

const base64ToBlobUrl = (base64: string, mime: string): string => {
  const byteString = atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime || 'image/jpeg' });
  return URL.createObjectURL(blob);
};

interface TagEditorModalProps {
  tracks: Track[];
  onClose: () => void;
  onSave: () => void;
  initialTab?: 'standard' | 'extended' | 'lyrics';
}

export const TagEditorModal = memo(
  ({ tracks, onClose, onSave, initialTab }: TagEditorModalProps) => {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tagInfo, setTagInfo] = useState<TagInfo | null>(null);
    const [activeTab, setActiveTab] = useState<'standard' | 'extended' | 'lyrics'>(
      initialTab || 'standard',
    );
    const [extendedFields, setExtendedFields] = useState<{ key: string; value: string }[]>([]);

    // Form state
    const [title, setTitle] = useState('');
    const [artist, setArtist] = useState('');
    const [album, setAlbum] = useState('');
    const [albumArtist, setAlbumArtist] = useState('');
    const [year, setYear] = useState('');
    const [trackNumber, setTrackNumber] = useState('');
    const [discNumber, setDiscNumber] = useState('');
    const [genre, setGenre] = useState('');
    const [composer, setComposer] = useState('');
    const [comment, setComment] = useState('');
    const [newCoverArt, setNewCoverArt] = useState<{
      base64: string;
      mime: string;
      url: string;
    } | null>(null);
    const [removeCover, setRemoveCover] = useState(false);
    const [lyricsContent, setLyricsContent] = useState('');
    const [lyricsError, setLyricsError] = useState<string | null>(null);
    const [isLyricsSaving, setIsLyricsSaving] = useState(false);
    const [clipboardMessage, setClipboardMessage] = useState<string | null>(null);
    const trackPath = tracks[0]?.filePath ?? null;
    const coverArtUrl = useCoverArt(
      tracks[0]?.filePath,
      tracks[0]?.hasCoverArt,
      true,
      'large',
      tracks[0]?.coverArtHash,
    );
    const coverPreviewUrl = useMemo(() => {
      if (removeCover) return null;
      if (newCoverArt?.url) return newCoverArt.url;
      return coverArtUrl;
    }, [coverArtUrl, newCoverArt, removeCover]);

    const {
      setClipboard,
      data: clipboardData,
      coverArt: clipboardArt,
      buildTagUpdateFromInfo,
      canPaste,
    } = useMetadataClipboardStore();

    useEffect(() => {
      return () => {
        if (newCoverArt?.url) {
          URL.revokeObjectURL(newCoverArt.url);
        }
      };
    }, [newCoverArt]);

    const isBatchEdit = tracks.length > 1;

    useEffect(() => {
      const loadTags = async () => {
        if (tracks.length === 0) return;

        try {
          setIsLoading(true);
          setError(null);

          if (isBatchEdit) {
            // For batch edit, just show empty fields
            setIsLoading(false);
            setExtendedFields([]);
          } else {
            // Single track - load full info
            const info = await readFullTags(tracks[0].filePath);
            setTagInfo(info);

            setTitle(info.title || '');
            setArtist(info.artist || '');
            setAlbum(info.album || '');
            setAlbumArtist(info.albumArtist || '');
            setYear(info.year?.toString() || '');
            setTrackNumber(info.trackNumber?.toString() || '');
            setDiscNumber(info.discNumber?.toString() || '');
            setGenre(info.genre || '');
            setComposer(info.composer || '');
            setComment(info.comment || '');
            setRemoveCover(false);
            setNewCoverArt(null);
            setExtendedFields(
              info.extraTags
                ? Object.entries(info.extraTags).map(([key, value]) => ({ key, value }))
                : [],
            );

            setIsLoading(false);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load tags');
          setIsLoading(false);
        }
      };

      loadTags();
    }, [tracks, isBatchEdit]);

    useEffect(() => {
      const loadLyrics = async () => {
        if (isBatchEdit || !trackPath) {
          setLyricsContent('');
          setLyricsError(null);
          return;
        }
        try {
          setLyricsError(null);
          const single = tracks.length === 1 ? tracks[0] : null;
          const content = await getLyricsForTrack(
            trackPath,
            false,
            single?.artist ?? '',
            single?.title ?? '',
            single?.album ?? '',
            single?.duration ?? 0,
          );
          if (content) {
            setLyricsContent(content);
          } else {
            setLyricsContent('');
            setLyricsError('No .lrc found yet. Saving will create one next to the track.');
          }
        } catch (err) {
          setLyricsContent('');
          setLyricsError('No .lrc found yet. Saving will create one next to the track.');
        }
      };

      loadLyrics();
    }, [isBatchEdit, trackPath, tracks]);

    useEffect(() => {
      if (initialTab) {
        setActiveTab(initialTab);
      }
    }, [initialTab]);

    const handleSelectCover = useCallback(async () => {
      try {
        const filePath = await selectImageFile();
        if (filePath) {
          const [base64, mime] = await readImageAsBase64(filePath);
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: mime });
          const url = URL.createObjectURL(blob);
          // Revoke previous preview URL
          setNewCoverArt((prev) => {
            if (prev?.url) URL.revokeObjectURL(prev.url);
            return { base64, mime, url };
          });
          setRemoveCover(false);
        }
      } catch (err) {
        reportError('Failed to select cover', { source: 'tag-editor-modal', error: err });
      }
    }, []);

    const handleRemoveCover = useCallback(() => {
      if (newCoverArt?.url) {
        URL.revokeObjectURL(newCoverArt.url);
      }
      setNewCoverArt(null);
      setRemoveCover(true);
    }, []);

    const handleSaveLyrics = useCallback(async () => {
      if (!trackPath) return;
      try {
        setIsLyricsSaving(true);
        setLyricsError(null);
        await writeLyricsForTrack(trackPath, lyricsContent ?? '');
      } catch (err) {
        setLyricsError(err instanceof Error ? err.message : 'Failed to save lyrics');
      } finally {
        setIsLyricsSaving(false);
      }
    }, [trackPath, lyricsContent]);

    const handleAddExtendedField = useCallback(() => {
      setExtendedFields((prev) => [...prev, { key: '', value: '' }]);
      setActiveTab('extended');
    }, []);

    const handleUpdateExtendedField = useCallback(
      (index: number, field: 'key' | 'value', value: string) => {
        setExtendedFields((prev) =>
          prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
        );
      },
      [],
    );

    const handleRemoveExtendedField = useCallback((index: number) => {
      setExtendedFields((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleAutoTag = useCallback(() => {
      const path = trackPath ?? tracks[0]?.filePath;
      if (!path) return;
      const derived = deriveTagsFromPath(path);
      setTitle((prev) => (prev ? prev : derived.title));
      setArtist((prev) => (prev ? prev : derived.artist));
      setAlbum((prev) => (prev ? prev : derived.album));
      setAlbumArtist((prev) => (prev ? prev : derived.artist));
      setActiveTab('standard');
    }, [trackPath, tracks]);

    const handleSave = useCallback(async () => {
      try {
        setIsSaving(true);
        setError(null);

        const updates: TagUpdate = {};
        const clearFields: TagClearField[] = [];
        const clearIfSingle = (field: TagClearField) => {
          if (!isBatchEdit) clearFields.push(field);
        };
        const parseTagNumber = (value: string) => {
          const trimmed = value.trim();
          if (!trimmed) return null;
          const parsed = Number.parseInt(trimmed, 10);
          return Number.isFinite(parsed) ? parsed : undefined;
        };

        // Batch edits only apply filled fields. Single-track edits may intentionally clear fields.
        if (title.trim()) updates.title = title.trim();
        else clearIfSingle('title');
        if (artist.trim()) updates.artist = artist.trim();
        else clearIfSingle('artist');
        if (album.trim()) updates.album = album.trim();
        else clearIfSingle('album');
        if (albumArtist.trim()) updates.albumArtist = albumArtist.trim();
        else clearIfSingle('albumArtist');
        const parsedYear = parseTagNumber(year);
        if (typeof parsedYear === 'number') updates.year = parsedYear;
        else if (parsedYear === null) clearIfSingle('year');
        const parsedTrackNumber = parseTagNumber(trackNumber);
        if (typeof parsedTrackNumber === 'number') updates.trackNumber = parsedTrackNumber;
        else if (parsedTrackNumber === null) clearIfSingle('trackNumber');
        const parsedDiscNumber = parseTagNumber(discNumber);
        if (typeof parsedDiscNumber === 'number') updates.discNumber = parsedDiscNumber;
        else if (parsedDiscNumber === null) clearIfSingle('discNumber');
        if (genre.trim()) updates.genre = genre.trim();
        else clearIfSingle('genre');
        if (composer.trim()) updates.composer = composer.trim();
        else clearIfSingle('composer');
        if (comment.trim()) updates.comment = comment.trim();
        else clearIfSingle('comment');
        if (clearFields.length > 0) updates.clearFields = clearFields;

        // Handle cover art
        if (newCoverArt) {
          updates.coverArtBase64 = newCoverArt.base64;
          updates.coverArtMime = newCoverArt.mime;
        }
        if (extendedFields.length > 0) {
          const extras = extendedFields
            .filter((f) => f.key.trim())
            .reduce<Record<string, string>>((acc, field) => {
              acc[field.key.trim()] = field.value;
              return acc;
            }, {});
          if (Object.keys(extras).length > 0) {
            updates.extraTags = extras;
          }
        }

        if (isBatchEdit) {
          const filePaths = tracks.map((t) => t.filePath);
          const errors = await writeTagsBatch(filePaths, updates);

          if (errors.length > 0) {
            setError(`Failed to update ${errors.length} file(s)`);
          }

          // Handle cover removal separately for batch
          if (removeCover) {
            for (const path of filePaths) {
              try {
                await removeCoverArt(path);
              } catch (e) {
                reportError('Failed to remove cover', { source: 'tag-editor-modal', error: e });
              }
            }
          }
          await refreshTracksByFilePaths(filePaths);
        } else {
          await writeTags(tracks[0].filePath, updates);

          if (removeCover) {
            await removeCoverArt(tracks[0].filePath);
          }
          await refreshTracksByFilePaths([tracks[0].filePath]);
        }

        setIsSaving(false);
        onSave();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save tags');
        setIsSaving(false);
      }
    }, [
      tracks,
      isBatchEdit,
      title,
      artist,
      album,
      albumArtist,
      year,
      trackNumber,
      discNumber,
      genre,
      composer,
      comment,
      newCoverArt,
      removeCover,
      extendedFields,
      onSave,
      onClose,
    ]);

    const handleCopyMetadata = useCallback(async () => {
      if (!trackPath) return;
      try {
        const info = tagInfo ?? (await readFullTags(trackPath));
        const update = buildTagUpdateFromInfo(info);
        let art = null;
        try {
          const artData = await getCoverArtData(trackPath);
          if (artData) {
            art = { mime: artData[0], base64: artData[1] };
          }
        } catch (err) {
          console.warn('Cover art copy failed:', err);
        }

        // Keep internal clipboard
        setClipboard(update, art, trackPath);

        // Also copy a plain-text summary to the system clipboard.
        const artist = update.artist || 'Unknown Artist';
        const title = update.title || 'Unknown Title';
        const systemClipboardUpdated = await clipboard.writeText(`${artist} - ${title}`);

        setClipboardMessage(
          systemClipboardUpdated ? 'Copied metadata' : 'Copied metadata inside Tarab only',
        );
      } catch (err) {
        reportError('Failed to copy metadata', { source: 'tag-editor-modal', error: err });
        setClipboardMessage('Copy failed');
      }
    }, [trackPath, tagInfo, buildTagUpdateFromInfo, setClipboard, setClipboardMessage]);

    const handlePasteMetadata = useCallback(() => {
      if (!clipboardData) return;

      const applyTextField = (
        value: string | null | undefined,
        setter: (value: string) => void,
      ) => {
        if (value !== undefined) {
          setter(value ?? '');
        }
      };
      const applyNumberField = (
        value: number | null | undefined,
        setter: (value: string) => void,
      ) => {
        if (value !== undefined) {
          setter(value === null ? '' : String(value));
        }
      };

      applyTextField(clipboardData.title, setTitle);
      applyTextField(clipboardData.artist, setArtist);
      applyTextField(clipboardData.album, setAlbum);
      applyTextField(clipboardData.albumArtist, setAlbumArtist);
      applyNumberField(clipboardData.year, setYear);
      applyNumberField(clipboardData.trackNumber, setTrackNumber);
      applyNumberField(clipboardData.discNumber, setDiscNumber);
      applyTextField(clipboardData.genre, setGenre);
      applyTextField(clipboardData.composer, setComposer);
      applyTextField(clipboardData.comment, setComment);
      if (clipboardData.extraTags) {
        setExtendedFields(
          Object.entries(clipboardData.extraTags).map(([key, value]) => ({
            key,
            value,
          })),
        );
      }

      if (clipboardArt) {
        try {
          const url = base64ToBlobUrl(clipboardArt.base64, clipboardArt.mime);
          if (newCoverArt?.url) {
            URL.revokeObjectURL(newCoverArt.url);
          }
          setNewCoverArt({
            base64: clipboardArt.base64,
            mime: clipboardArt.mime,
            url,
          });
          setRemoveCover(false);
        } catch (err) {
          reportError('Failed to apply cover art from clipboard', {
            source: 'tag-editor-modal',
            error: err,
          });
        }
      }

      setClipboardMessage('Pasted metadata');
    }, [clipboardData, clipboardArt, newCoverArt, setClipboardMessage]);

    return (
      <div className="fixed inset-0 z-50 bg-background text-text-primary">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-background-elevated/50 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <IconButton
                onClick={onClose}
                className="p-2 text-text-secondary hover:text-white rounded-full transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </IconButton>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
                  Metadata Editor
                </p>
                <p className="text-sm font-semibold text-text-primary">
                  {isBatchEdit
                    ? `Editing ${tracks.length} tracks`
                    : tagInfo?.filePath
                      ? 'Edit Track Info'
                      : 'Edit Track Info'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={handleCopyMetadata}
                disabled={isSaving || isLoading || !trackPath}
                className="rounded-xl flex items-center gap-2"
              >
                <Clipboard className="w-4 h-4" />
                Copy
              </Button>
              <Button
                variant="secondary"
                onClick={handlePasteMetadata}
                disabled={!canPaste() || isSaving}
                className="rounded-xl flex items-center gap-2"
              >
                <ClipboardCheck className="w-4 h-4" />
                Paste
              </Button>
              <Button
                variant="secondary"
                onClick={handleAutoTag}
                disabled={isSaving || isLoading || isBatchEdit}
                title={isBatchEdit ? 'Auto-Tag is available for single-track edits' : undefined}
                className="rounded-xl flex items-center gap-2"
              >
                <Wand2 className="w-4 h-4" />
                Auto-Tag
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={isSaving} className="rounded-xl">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isLoading || isSaving}
                className="rounded-xl bg-white text-black hover:bg-white/90"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </div>
          {clipboardMessage && (
            <div className="px-6 pb-2 text-xs text-text-secondary">{clipboardMessage}</div>
          )}

          <div className="flex-1 flex overflow-hidden">
            {/* Left rail */}
            <aside className="hidden lg:flex w-80 flex-col gap-6 p-6 border-r border-white/5 bg-background-elevated/60">
              <div>
                <p className="text-xs uppercase tracking-widest text-text-subtle mb-3">
                  Album Artwork
                </p>
                <div
                  className={clsx(
                    'aspect-square w-full rounded-2xl border border-dashed border-white/15',
                    'flex items-center justify-center overflow-hidden',
                    'bg-white/5 cursor-pointer hover:border-primary/60 transition-colors',
                  )}
                  onClick={handleSelectCover}
                >
                  {coverPreviewUrl ? (
                    <img src={coverPreviewUrl} alt="Cover" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-text-muted">
                      <Image className="w-8 h-8 mx-auto mb-2" />
                      <span className="text-xs">Drop or click to add</span>
                    </div>
                  )}
                </div>
                {coverPreviewUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveCover}
                    className="mt-3 w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-950/20 flex items-center justify-center gap-1 rounded-full h-8"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove artwork
                  </Button>
                )}
              </div>

              {!isBatchEdit && tagInfo && (
                <div>
                  <p className="text-xs uppercase tracking-widest text-text-subtle mb-3">
                    File Info
                  </p>
                  <div className="panel rounded-2xl p-4 space-y-2 text-xs text-text-muted text-mono">
                    <div className="flex justify-between">
                      <span>Format</span>
                      <span className="text-text-primary">{tagInfo.fileFormat}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Duration</span>
                      <span className="text-text-primary">
                        {Math.floor(tagInfo.durationSecs / 60)}:
                        {Math.floor(tagInfo.durationSecs % 60)
                          .toString()
                          .padStart(2, '0')}
                      </span>
                    </div>
                    {tagInfo.bitrate && (
                      <div className="flex justify-between">
                        <span>Bitrate</span>
                        <span className="text-text-primary">{tagInfo.bitrate} kbps</span>
                      </div>
                    )}
                    {tagInfo.sampleRate && (
                      <div className="flex justify-between">
                        <span>Sample Rate</span>
                        <span className="text-text-primary">{tagInfo.sampleRate} Hz</span>
                      </div>
                    )}
                    {tagInfo.channels && (
                      <div className="flex justify-between">
                        <span>Channels</span>
                        <span className="text-text-primary">{tagInfo.channels}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </aside>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-6 max-w-3xl">
                  <div className="lg:hidden">
                    <p className="text-xs uppercase tracking-widest text-text-subtle mb-3">
                      Album Artwork
                    </p>
                    <div
                      className={clsx(
                        'aspect-square w-full rounded-2xl border border-dashed border-white/15',
                        'flex items-center justify-center overflow-hidden',
                        'bg-white/5 cursor-pointer hover:border-primary/60 transition-colors',
                      )}
                      onClick={handleSelectCover}
                    >
                      {coverPreviewUrl ? (
                        <img
                          src={coverPreviewUrl}
                          alt="Cover"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center text-text-muted">
                          <Image className="w-8 h-8 mx-auto mb-2" />
                          <span className="text-xs">Drop or click to add</span>
                        </div>
                      )}
                    </div>
                    {coverPreviewUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveCover}
                        className="mt-3 w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-950/20 flex items-center justify-center gap-1 rounded-full h-8"
                      >
                        <Trash2 className="w-3 h-3" />
                        Remove artwork
                      </Button>
                    )}
                  </div>

                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                      {error}
                    </div>
                  )}

                  <MetadataClipboard onPaste={handlePasteMetadata} />

                  {isBatchEdit && (
                    <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg text-primary text-sm">
                      Only filled fields will be applied to all selected tracks.
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {(['standard', 'extended', 'lyrics'] as const).map((tab) => {
                      const disabled = tab === 'lyrics' && isBatchEdit;
                      return (
                        <Button
                          key={tab}
                          variant={activeTab === tab ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => !disabled && setActiveTab(tab)}
                          disabled={disabled}
                          className={clsx(
                            'rounded-full text-sm font-medium transition px-4 py-2 h-auto',
                            activeTab === tab
                              ? 'bg-white text-black hover:bg-white/90'
                              : 'text-text-primary hover:text-white hover:bg-white/10',
                            disabled && 'opacity-50 cursor-not-allowed',
                          )}
                        >
                          {tab === 'standard'
                            ? 'Standard Tags'
                            : tab === 'extended'
                              ? 'Extended Tags'
                              : 'Lyrics'}
                        </Button>
                      );
                    })}
                  </div>

                  {activeTab === 'standard' && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm text-text-secondary mb-1">Title</label>
                          <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={
                              isBatchEdit ? 'Leave empty to keep original' : 'Track title'
                            }
                            className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-text-secondary mb-1">Artist</label>
                          <input
                            type="text"
                            value={artist}
                            onChange={(e) => setArtist(e.target.value)}
                            placeholder={
                              isBatchEdit ? 'Leave empty to keep original' : 'Artist name'
                            }
                            className="w-full panel rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-text-secondary mb-1">
                            Album Artist
                          </label>
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
                            placeholder={
                              isBatchEdit ? 'Leave empty to keep original' : 'Album name'
                            }
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
                                      onChange={(e) =>
                                        handleUpdateExtendedField(i, 'key', e.target.value)
                                      }
                                      placeholder="FIELD NAME"
                                      className="w-full bg-transparent border border-white/10 rounded-lg px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                                    />
                                  </td>
                                  <td className="p-3">
                                    <input
                                      value={tag.value}
                                      onChange={(e) =>
                                        handleUpdateExtendedField(i, 'value', e.target.value)
                                      }
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
                      <p className="text-[11px] text-text-muted">
                        These fields save alongside standard tags. Leave blank to keep current
                        values.
                      </p>
                    </div>
                  )}

                  {activeTab === 'lyrics' && !isBatchEdit && (
                    <div className="panel rounded-2xl p-4 border border-white/10">
                      <LyricsEditor
                        trackPath={trackPath}
                        lyricsContent={lyricsContent}
                        onChange={setLyricsContent}
                        onSave={handleSaveLyrics}
                        isSaving={isLyricsSaving}
                      />
                      {lyricsError && <p className="text-xs text-red-400 mt-2">{lyricsError}</p>}
                    </div>
                  )}

                  {activeTab === 'lyrics' && isBatchEdit && (
                    <div className="p-3 bg-white/5 border border-white/10 rounded-lg text-text-muted text-sm">
                      Lyrics editing is available when a single track is selected.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

TagEditorModal.displayName = 'TagEditorModal';
