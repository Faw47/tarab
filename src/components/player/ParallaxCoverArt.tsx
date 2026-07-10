import { clsx } from 'clsx';
import { Music } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { getCoverArtBlobFallback, markCoverArtProtocolFailed } from '../../hooks/useCoverArt';
import { useParallax } from './PlayerParallax';

export interface ParallaxCoverArtProps {
  src?: string;
  alt?: string;
  isPlaying: boolean;
  className?: string; // For layout-specific sizing
  style?: React.CSSProperties;
  coverArtHash?: string | null;
}

export const ParallaxCoverArt = memo(
  ({ src, alt, isPlaying, className, style: propStyle, coverArtHash }: ParallaxCoverArtProps) => {
    const { x, y } = useParallax();
    const [imageSrc, setImageSrc] = useState<string | undefined>(src);
    const [hasError, setHasError] = useState(false);

    const combinedStyle = useMemo(
      () => ({
        ...propStyle,
        transform: `translate3d(${x}px, ${y}px, 0) scale(1.02)`,
      }),
      [x, y, propStyle],
    );

    // Update imageSrc when src prop changes
    useEffect(() => {
      setImageSrc(src);
      setHasError(false);
    }, [src]);

    const handleImageError = useCallback(async () => {
      // If it's a protocol URL and we have a hash, try IPC fallback
      if (imageSrc?.startsWith('cover-art://') && coverArtHash) {
        const size = imageSrc.includes('/large')
          ? 'large'
          : imageSrc.includes('/medium')
            ? 'medium'
            : 'small';

        markCoverArtProtocolFailed(coverArtHash, size);

        const blobUrl = await getCoverArtBlobFallback(coverArtHash, size);
        if (blobUrl) {
          setImageSrc(blobUrl);
          setHasError(false);
          return;
        }
      }

      setHasError(true);
    }, [imageSrc, coverArtHash]);

    return (
      <div
        className={clsx(
          'relative mx-auto rounded-[32px] overflow-hidden border border-white/10 bg-gradient-to-br from-white/10 to-transparent',
          'aspect-square shadow-[0_30px_80px_rgba(0,0,0,0.55)]', // Default shadow, can be overridden by className or managed here
          className,
        )}
        style={combinedStyle}
      >
        {imageSrc && !hasError ? (
          <img
            src={imageSrc}
            alt={alt || 'Album Art'}
            className={clsx(
              'w-full h-full object-cover transition-transform duration-[20s] ease-linear',
              isPlaying ? 'scale-110' : 'scale-100',
            )}
            onError={handleImageError}
          />
        ) : (
          <div className="w-full h-full panel flex items-center justify-center">
            <Music className="w-16 h-16 text-text-muted" />
          </div>
        )}
      </div>
    );
  },
);

ParallaxCoverArt.displayName = 'ParallaxCoverArt';
