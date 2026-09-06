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
  type ArtworkMime,
  getCoverArtData,
  getLyricsForTrack,
  pickCoverArt,
  readFullTags,
  removeCoverArt,
  writeLyricsForTrack,
  writeTags,
  writeTagsBatch,
} from '../../lib/tauri-commands';
import { refreshTracksByFilePaths } from '../../lib/track-refresh';
import { clipboard } from '../../platform/clipboard';
import { useMetadataClipboardStore } from '../../store/metadata-clipboard-store';
import type { TagClearField, TagInfo, TagUpdate, Track } from '../../types';
import { MetadataClipboard } from '../metadata/MetadataClipboard';
import { buildExtraTagUpdates } from '../tagmanager/tag-manager-mutations';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { IconButton } from '../ui/IconButton';
import { getLyricsUtf8ByteLength, LyricsEditor, MAX_LYRICS_SIDECAR_BYTES } from './LyricsEditor';
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

const MAX_ARTWORK_BYTES = 25 * 1024 * 1024;
const MAX_ARTWORK_BASE64_LENGTH = Math.ceil(MAX_ARTWORK_BYTES / 3) * 4;

const sniffArtworkMime = (bytes: Uint8Array): ArtworkMime | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
};

const base64ToArtwork = (base64: string): { mime: ArtworkMime; url: string } => {
  if (base64.length > MAX_ARTWORK_BASE64_LENGTH) {
    throw new Error('Artwork exceeds the encoded byte limit.');
  }
  const byteString = atob(base64);
  if (byteString.length === 0 || byteString.length > MAX_ARTWORK_BYTES) {
    throw new Error('Artwork exceeds the encoded byte limit.');
  }
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  const mime = sniffArtworkMime(bytes);
  if (!mime) throw new Error('Artwork must be JPEG, PNG, or WebP.');
  return { mime, url: URL.createObjectURL(new Blob([bytes], { type: mime })) };
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

    const hasTracks = tracks.length > 0;
    const isBatchEdit = tracks.length > 1;

    useEffect(() => {
      let cancelled = false;
      const loadTags = async () => {
        if (!hasTracks) {
          setTagInfo(null);
          setExtendedFields([]);
          setError('No tracks selected.');
          setIsLoading(false);
          return;
        }

        try {
          setIsLoading(true);
          setError(null);

          if (isBatchEdit) {
            // For batch edit, just show empty fields
            if (cancelled) return;
            setIsLoading(false);
            setExtendedFields([]);
          } else {
            // Single track - load full info
            const info = await readFullTags(tracks[0].filePath);
            if (cancelled) return;
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
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Failed to load tags');
          setIsLoading(false);
        }
      };

      void loadTags();
      return () => {
        cancelled = true;
      };
    }, [hasTracks, tracks, isBatchEdit]);

    useEffect(() => {
      let cancelled = false;
      const loadLyrics = async () => {
        if (isBatchEdit || !trackPath) {
          setLyricsContent('');
          setLyricsError(null);
          return;
        }
        setLyricsContent('');
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
          if (cancelled) return;
          if (content) {
            setLyricsContent(content);
          } else {
            setLyricsContent('');
            setLyricsError('No .lrc found yet. Saving will create one next to the track.');
          }
        } catch (err) {
          if (cancelled) return;
          setLyricsContent('');
          setLyricsError('No .lrc found yet. Saving will create one next to the track.');
        }
      };

      void loadLyrics();
      return () => {
        cancelled = true;
      };
    }, [isBatchEdit, trackPath, tracks]);

    useEffect(() => {
      if (initialTab) {
        setActiveTab(initialTab);
      }
    }, [initialTab]);

    const handleSelectCover = useCallback(async () => {
      try {
        const selected = await pickCoverArt();
        if (selected) {
          const preview = base64ToArtwork(selected.base64);
          if (preview.mime !== selected.mime) {
            URL.revokeObjectURL(preview.url);
            throw new Error('Selected artwork MIME did not match its contents.');
          }
          setNewCoverArt((prev) => {
            if (prev?.url) URL.revokeObjectURL(prev.url);
            return { base64: selected.base64, mime: preview.mime, url: preview.url };
          });
          setRemoveCover(false);
          setError(null);
        }
      } catch (err) {
        reportError('Failed to select cover', { source: 'tag-editor-modal', error: err });
      }
    }, []);

    const applyCoverFile = useCallback(async (file: File) => {
      if (file.size === 0 || file.size > MAX_ARTWORK_BYTES) {
        setError('Artwork must be 25 MB or smaller.');
        return;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error ?? new Error('Could not read artwork'));
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.readAsDataURL(file);
        });
        const separator = dataUrl.indexOf(',');
        if (separator < 0) throw new Error('Tarab could not read the artwork.');
        const base64 = dataUrl.slice(separator + 1);
        const preview = base64ToArtwork(base64);
        setNewCoverArt((previous) => {
          if (previous?.url) URL.revokeObjectURL(previous.url);
          return { base64, mime: preview.mime, url: preview.url };
        });
        setRemoveCover(false);
        setError(null);
      } catch {
        setError('Choose a valid JPEG, PNG, or WebP image.');
      }
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

    const handleSaveLyrics = useCallback(
      async (content: string) => {
        if (!trackPath) return;
        if (getLyricsUtf8ByteLength(content) > MAX_LYRICS_SIDECAR_BYTES) {
          setLyricsError('Lyrics must be 1 MiB (1,048,576 UTF-8 bytes) or smaller.');
          return;
        }
        try {
          setIsLyricsSaving(true);
          setLyricsError(null);
          await writeLyricsForTrack(trackPath, content);
        } catch (err) {
          setLyricsError(err instanceof Error ? err.message : 'Failed to save lyrics');
        } finally {
          setIsLyricsSaving(false);
        }
      },
      [trackPath],
    );

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
      if (!hasTracks) {
        setError('No tracks selected.');
        return;
      }

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
        const extraTagUpdates = buildExtraTagUpdates(tagInfo?.extraTags, extendedFields);
        if (extraTagUpdates) updates.extraTags = extraTagUpdates;

        if (isBatchEdit) {
          const filePaths = tracks.map((t) => t.filePath);
          const results = await writeTagsBatch(filePaths, updates);
          const tagErrors = results.filter((result) => result.status === 'failed');
          const successfulPaths = results
            .filter((result) => result.status === 'success')
            .map((result) => result.path);

          const coverErrors: string[] = [];
          if (removeCover) {
            for (const path of successfulPaths) {
              try {
                await removeCoverArt(path);
              } catch (e) {
                coverErrors.push(path);
                reportError('Failed to remove cover', { source: 'tag-editor-modal', error: e });
              }
            }
          }
          await refreshTracksByFilePaths(successfulPaths);
          const failureCount = tagErrors.length + coverErrors.length;
          if (failureCount > 0) {
            setError(`Failed to fully update ${failureCount} file(s)`);
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
      hasTracks,
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
          const preview = base64ToArtwork(clipboardArt.base64);
          if (newCoverArt?.url) {
            URL.revokeObjectURL(newCoverArt.url);
          }
          setNewCoverArt({
            base64: clipboardArt.base64,
            mime: preview.mime,
            url: preview.url,
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
          className="inset-0 top-0 left-0 block h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-background p-0 text-text-primary shadow-none"
        >
          <DialogTitle className="sr-only">Metadata editor</DialogTitle>
          <DialogDescription className="sr-only">
            Edit metadata, artwork, and lyrics for the selected tracks.
          </DialogDescription>
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
                  disabled={!hasTracks || !canPaste() || isSaving}
                  className="rounded-xl flex items-center gap-2"
                >
                  <ClipboardCheck className="w-4 h-4" />
                  Paste
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleAutoTag}
                  disabled={!hasTracks || isSaving || isLoading || isBatchEdit}
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
                  disabled={!hasTracks || isLoading || isSaving}
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
                {hasTracks && (
                  <TagEditorArtworkPanel
                    previewUrl={coverPreviewUrl}
                    onSelect={handleSelectCover}
                    onKeyDown={handleCoverKeyDown}
                    onDrop={handleCoverDrop}
                    onPaste={handleCoverPaste}
                    onRemove={handleRemoveCover}
                  />
                )}

                {hasTracks && !isBatchEdit && tagInfo && <TagEditorFileInfo tagInfo={tagInfo} />}
              </aside>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {isLoading ? (
                  <div
                    className="flex items-center justify-center py-12"
                    role="status"
                    aria-label="Loading tags"
                  >
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : !hasTracks ? (
                  <div
                    className="mx-auto max-w-lg rounded-xl border border-[var(--state-error-border)] bg-[var(--state-error-surface)] p-4 text-sm text-[var(--state-error-ink)]"
                    role="status"
                  >
                    No tracks selected. Close this editor and choose at least one track.
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
                      <div className="p-3 bg-[var(--state-error-surface)] border border-[var(--state-error-border)] rounded-lg text-[var(--state-error-ink)] text-sm">
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
                        const disabled = !hasTracks || (tab === 'lyrics' && isBatchEdit);
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

                    {activeTab === 'lyrics' && tracks.length === 1 && (
                      <div className="panel rounded-2xl p-4 border border-white/10">
                        <LyricsEditor
                          track={tracks[0]}
                          lyricsContent={lyricsContent}
                          onChange={setLyricsContent}
                          onSave={handleSaveLyrics}
                          isSaving={isLyricsSaving}
                        />
                        {lyricsError && (
                          <p className="text-xs text-[var(--state-error-ink)] mt-2">
                            {lyricsError}
                          </p>
                        )}
                      </div>
                    )}

                    {activeTab === 'lyrics' && hasTracks && isBatchEdit && (
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
