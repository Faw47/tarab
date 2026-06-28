import { clsx } from 'clsx';
import { memo } from 'react';

interface CoverArtSkeletonProps {
  className?: string;
  roundedClassName?: string;
}

export const CoverArtSkeleton = memo(
  ({ className, roundedClassName = 'rounded-lg' }: CoverArtSkeletonProps) => (
    <div
      className={clsx('relative overflow-hidden skeleton-shimmer', roundedClassName, className)}
      aria-hidden="true"
    />
  ),
);

CoverArtSkeleton.displayName = 'CoverArtSkeleton';
