import { clsx } from 'clsx';
import { Clipboard, ClipboardCheck, Loader2, Save, Wand2, X } from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { IconButton } from '../ui/IconButton';
import { LyricsEditor } from './LyricsEditor';
import { TagEditorArtworkPanel } from './TagEditorArtworkPanel';
import { TagEditorFileInfo } from './TagEditorFileInfo';
import { TagEditorMetadataForm } from './TagEditorMetadataForm';

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

    const applyCoverFile = useCallback(async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Choose a supported image file.');
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setError('Artwork must be 20 MB or smaller.');
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Could not read artwork'));
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.readAsDataURL(file);
      });
      const separator = dataUrl.indexOf(',');
      if (separator < 0) {
        setError('Tarab could not read the artwork.');
        return;
      }
      const url = URL.createObjectURL(file);
      setNewCoverArt((previous) => {
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return { base64: dataUrl.slice(separator + 1), mime: file.type, url };
      });
      setRemoveCover(false);
      setError(null);
    }, []);

    const handleCoverDrop = useCallback(
      (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) void applyCoverFile(file);
      },
      [applyCoverFile],
    );

    const handleCoverPaste = useCallback(
      (event: ClipboardEvent<HTMLDivElement>) => {
        const file = Array.from(event.clipboardData.files).find((item) =>
          item.type.startsWith('image/'),
        );
        if (!file) return;
        event.preventDefault();
        void applyCoverFile(file);
      },
      [applyCoverFile],
    );

    const handleCoverKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void handleSelectCover();
      },
      [handleSelectCover],
    );

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
          const results = await writeTagsBatch(filePaths, updates);
          const errors = results.filter((result) => result.status === 'failed');

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
          await refreshTracksByFilePaths(
            results.filter((result) => result.status === 'success').map((result) => result.path),
          );
          if (errors.length > 0) {
            setIsSaving(false);
            return;
          }
        } else {
          const result = await writeTags(tracks[0].filePath, updates);
          if (result.status !== 'success') {
            throw new Error(result.errorMessage ?? 'Tarab could not write the track tags.');
          }

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
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="inset-0 top-0 left-0 z-50 block h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-background p-0 text-text-primary shadow-none"
        >
          <DialogTitle className="sr-only">Metadata editor</DialogTitle>
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
                <Button
                  variant="ghost"
                  onClick={onClose}
                  disabled={isSaving}
                  className="rounded-xl"
                >
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
                <TagEditorArtworkPanel
                  previewUrl={coverPreviewUrl}
                  onSelect={handleSelectCover}
                  onKeyDown={handleCoverKeyDown}
                  onDrop={handleCoverDrop}
                  onPaste={handleCoverPaste}
                  onRemove={handleRemoveCover}
                />

                {!isBatchEdit && tagInfo && <TagEditorFileInfo tagInfo={tagInfo} />}
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
                      <TagEditorArtworkPanel
                        previewUrl={coverPreviewUrl}
                        onSelect={handleSelectCover}
                        onKeyDown={handleCoverKeyDown}
                        onDrop={handleCoverDrop}
                        onPaste={handleCoverPaste}
                        onRemove={handleRemoveCover}
                      />
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

                    <TagEditorMetadataForm
                      activeTab={activeTab}
                      isBatchEdit={isBatchEdit}
                      title={title}
                      setTitle={setTitle}
                      artist={artist}
                      setArtist={setArtist}
                      album={album}
                      setAlbum={setAlbum}
                      albumArtist={albumArtist}
                      setAlbumArtist={setAlbumArtist}
                      year={year}
                      setYear={setYear}
                      trackNumber={trackNumber}
                      setTrackNumber={setTrackNumber}
                      discNumber={discNumber}
                      setDiscNumber={setDiscNumber}
                      genre={genre}
                      setGenre={setGenre}
                      composer={composer}
                      setComposer={setComposer}
                      comment={comment}
                      setComment={setComment}
                      extendedFields={extendedFields}
                      onAddExtendedField={handleAddExtendedField}
                      onUpdateExtendedField={handleUpdateExtendedField}
                      onRemoveExtendedField={handleRemoveExtendedField}
                    />

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
        </DialogContent>
      </Dialog>
    );
  },
);

TagEditorModal.displayName = 'TagEditorModal';
