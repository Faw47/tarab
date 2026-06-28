import { clsx } from 'clsx';
import { Music } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { Blurhash } from 'react-blurhash';
import { useShallow } from 'zustand/react/shallow';
import {
  getCoverArtDataUrlFallback,
  markCoverArtProtocolFailed,
  useCoverArt,
} from '../../hooks/useCoverArt';
import { cacheGetThumbnailDataUrl, getCoverArt } from '../../lib/tauri-commands';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import { CoverArtSkeleton } from './CoverArtSkeleton';

const MAX_FALLBACK_DATA_URL_LENGTH = 3_000_000;

interface CoverArtImageProps {
  track: Pick<Track, 'filePath' | 'hasCoverArt' | 'album' | 'coverArtHash' | 'blurhash'>;
  className?: string;
  imgClassName?: string;
  roundedClassName?: string;
  iconClassName?: string;
  alt?: string;
  lazy?: boolean;
  size?: 'small' | 'medium' | 'large';
  /** Stable id for View Transitions API (e.g. cover-${track.id}) so cover art morphs when switching list/grid. */
  viewTransitionName?: string;
  /** Neo theme: square album frame vs circular artist portrait. */
  variant?: 'album' | 'artist';
}

/**
 * Generic lazy-loading cover art renderer with a Music icon fallback.
 */
export const CoverArtImage = memo(
  ({
    track,
    className,
    imgClassName = 'w-full h-full',
    roundedClassName = 'rounded-lg',
    iconClassName = 'w-6 h-6',
    alt,
    lazy = true,
    size = 'medium',
    viewTransitionName,
    variant,
  }: CoverArtImageProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const [inView, setInView] = useState(!lazy);
    const [overrideSrc, setOverrideSrc] = useState<string | null>(null);
    const errorCount = useRef(0);

    useEffect(() => {
      if (!lazy || inView) return;
      const node = ref.current;
      if (!node || !('IntersectionObserver' in window)) {
        setInView(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              setInView(true);
              observer.disconnect();
              break;
            }
          }
        },
        { rootMargin: '200px' },
      );
      observer.observe(node);
      return () => observer.disconnect();
    }, [lazy, inView]);

    const art = useCoverArt(
      track.filePath,
      track.hasCoverArt,
      inView,
      size,
      track.coverArtHash ?? undefined,
    );
    const src = overrideSrc ?? art ?? null;

    const handleError = async () => {
      if (!track.hasCoverArt || !track.filePath) return;
      if (errorCount.current > 1) return;
      errorCount.current += 1;

      // Mark protocol as failed for this hash/size combination
      if (track.coverArtHash && src?.startsWith('cover-art://')) {
        markCoverArtProtocolFailed(track.coverArtHash, size);
      }

      // If we have a hash, try IPC fallback (protocol likely failed)
      if (track.coverArtHash) {
        try {
          const dataUrl = await getCoverArtDataUrlFallback(track.coverArtHash, size);
          if (dataUrl && dataUrl.length <= MAX_FALLBACK_DATA_URL_LENGTH) {
            setOverrideSrc(dataUrl);
            return;
          }
        } catch (e) {
          // IPC fallback failed, try getting hash from file
        }
      }

      // Fallback: get hash from file and try IPC
      try {
        const hash = await getCoverArt(track.filePath);
        if (hash) {
          // Try IPC data URL instead of protocol URL
          try {
            const dataUrl = await cacheGetThumbnailDataUrl(hash, size);
            if (dataUrl && dataUrl.length <= MAX_FALLBACK_DATA_URL_LENGTH) {
              setOverrideSrc(dataUrl);
              return;
            }
          } catch (e) {
            // IPC failed, fallback to icon
          }
        }
      } catch (e) {
        // ignore fetch errors, fallback to icon
      }
    };
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';
    const neoShapeClass =
      isNeobrutalism && variant === 'artist'
        ? 'neo-artist-avatar'
        : isNeobrutalism && variant === 'album'
          ? 'neo-cover-album'
          : '';
    const effectiveRoundedClassName =
      isNeobrutalism && variant ? '' : isNeobrutalism ? 'radius-r2' : roundedClassName;
    const [isLoaded, setIsLoaded] = useState(false);

    return (
      <div
        ref={ref}
        className={clsx(
          'relative bg-surface-light flex items-center justify-center overflow-hidden',
          neoShapeClass,
          effectiveRoundedClassName,
          className,
        )}
        style={viewTransitionName ? { viewTransitionName } : undefined}
      >
        {!src && !track.blurhash && (
          <CoverArtSkeleton
            className="absolute inset-0"
            roundedClassName={effectiveRoundedClassName}
          />
        )}

        {track.blurhash && !isLoaded && (
          <div className="absolute inset-0 z-0">
            <Blurhash
              hash={track.blurhash}
              width="100%"
              height="100%"
              resolutionX={32}
              resolutionY={32}
              punch={1}
            />
          </div>
        )}

        {src ? (
          <img
            src={src}
            alt={alt || track.album || 'Album art'}
            className={clsx(
              'object-cover relative z-10 transition-opacity duration-300',
              isLoaded ? 'opacity-100' : 'opacity-0',
              effectiveRoundedClassName,
              imgClassName,
            )}
            loading="lazy"
            decoding="async"
            onLoad={() => setIsLoaded(true)}
            onError={handleError}
          />
        ) : (
          !track.blurhash && (
            <Music className={clsx('text-text-muted relative z-10', iconClassName)} />
          )
        )}
      </div>
    );
  },
);

CoverArtImage.displayName = 'CoverArtImage';
