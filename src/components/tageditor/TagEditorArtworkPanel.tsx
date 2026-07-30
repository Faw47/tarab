import { Image, Trash2 } from 'lucide-react';
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react';
import { Button } from '../ui/button';

interface TagEditorArtworkPanelProps {
  previewUrl: string | null;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onRemove: () => void;
}

export function TagEditorArtworkPanel({
  previewUrl,
  onSelect,
  onKeyDown,
  onDrop,
  onPaste,
  onRemove,
}: TagEditorArtworkPanelProps) {
  return (
    <section aria-labelledby="tag-editor-artwork-title">
      <p
        id="tag-editor-artwork-title"
        className="text-xs uppercase tracking-widest text-text-subtle mb-3"
      >
        Album Artwork
      </p>
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose, drop, or paste album artwork"
        className="aspect-square w-full rounded-2xl border border-dashed border-white/15 flex items-center justify-center overflow-hidden bg-white/5 cursor-pointer hover:border-primary/60 transition-colors"
        onClick={onSelect}
        onKeyDown={onKeyDown}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Album artwork preview"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center text-text-muted">
            <Image className="w-8 h-8 mx-auto mb-2" aria-hidden="true" />
            <span className="text-xs">Drop, paste, or click to add</span>
          </div>
        )}
      </div>
      {previewUrl && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="mt-3 w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-950/20 flex items-center justify-center gap-1 rounded-full h-8"
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
          Remove artwork
        </Button>
      )}
    </section>
  );
}
