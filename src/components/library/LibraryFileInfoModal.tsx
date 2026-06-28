import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Track } from '../../types';
import { Button } from '../ui/button';
import { IconButton } from '../ui/IconButton';

interface LibraryFileInfoModalProps {
  track: Track;
  isOpen: boolean;
  onClose: () => void;
  onEditTags?: (track: Track) => void;
  formatSize: (size?: number) => string;
  getFormatLabel: (track: Track) => string;
}

export const LibraryFileInfoModal = ({
  track,
  isOpen,
  onClose,
  onEditTags,
  formatSize,
  getFormatLabel,
}: LibraryFileInfoModalProps) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;

    const dialogEl = dialogRef.current;
    const focusableSelectors = [
      'button',
      '[href]',
      'input',
      'select',
      'textarea',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const focusFirstElement = () => {
      if (!dialogEl) return;
      const focusable = dialogEl.querySelectorAll<HTMLElement>(focusableSelectors);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        dialogEl.focus();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      if (!dialogEl) return;

      const focusable = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(focusableSelectors),
      ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const isShift = event.shiftKey;

      if (!current) {
        first.focus();
        event.preventDefault();
        return;
      }

      if (!dialogEl.contains(current)) {
        first.focus();
        event.preventDefault();
        return;
      }

      if (!isShift && current === last) {
        first.focus();
        event.preventDefault();
        return;
      }

      if (isShift && current === first) {
        last.focus();
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    focusFirstElement();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedElement.current) {
        previouslyFocusedElement.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const handleBackdropClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-info-title"
      aria-describedby="file-info-description"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="relative w-[420px] max-w-[90vw] rounded-[28px] border border-white/15 bg-gradient-to-br from-white/12 via-white/6 to-white/3 p-[1px] shadow-[0_40px_120px_rgba(0,0,0,0.8)] focus:outline-none"
      >
        <div className="relative rounded-[26px] bg-gradient-to-br from-black/85 via-black/80 to-black/90 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(255,255,255,0.12),transparent_55%),radial-gradient(circle_at_100%_100%,rgba(255,255,255,0.08),transparent_55%)]" />
          <div className="relative p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3
                  id="file-info-title"
                  className="text-base font-semibold text-white tracking-tight"
                >
                  File properties
                </h3>
                <p id="file-info-description" className="mt-1 text-[11px] text-text-muted">
                  Technical details for{' '}
                  <span className="font-medium text-text-primary">
                    {track.title || 'Untitled track'}
                  </span>
                  .
                </p>
              </div>
              <IconButton
                onClick={onClose}
                className="p-1.5 text-text-muted hover:text-white rounded-full hover:bg-white/10"
                aria-label="Close file properties"
              >
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="space-y-4">
              <div className="volumetric-glass relative p-3 rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="text-[10px] text-text-subtle uppercase tracking-[0.18em] mb-1.5">
                  Path
                </div>
                <div className="text-xs font-mono text-text-primary break-all leading-relaxed">
                  {track.filePath}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm text-text-primary">
                <div>
                  <div className="text-[10px] text-text-subtle uppercase tracking-[0.18em] mb-0.5">
                    Format
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/15 bg-white/[0.02] text-[11px] font-semibold">
                    {getFormatLabel(track)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-text-subtle uppercase tracking-[0.18em] mb-0.5">
                    Bitrate
                  </div>
                  <div className="text-xs text-text-primary">
                    {track.bitrate ? `${track.bitrate} kbps` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-text-subtle uppercase tracking-[0.18em] mb-0.5">
                    Sample Rate
                  </div>
                  <div className="text-xs text-text-primary">
                    {track.sampleRate ? `${track.sampleRate} Hz` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-text-subtle uppercase tracking-[0.18em] mb-0.5">
                    Size
                  </div>
                  <div className="text-xs text-text-primary">{formatSize(track.fileSize)}</div>
                </div>
              </div>

              <p className="text-center text-[10px] text-text-subtle pt-1">
                Press Esc to close this window
              </p>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onEditTags?.(track)}
                  className="flex-1 text-xs h-8 rounded-full"
                >
                  Edit tags
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="flex-1 text-xs h-8 rounded-full text-text-secondary hover:text-red-200 hover:bg-red-950/40"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
