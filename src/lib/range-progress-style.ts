import type { CSSProperties } from 'react';

export const rangeProgressStyle = (value: number, min: number, max: number): CSSProperties => {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 1;
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, safeMin), safeMax) : safeMin;
  const progress = ((safeValue - safeMin) / (safeMax - safeMin)) * 100;

  return { '--range-progress': `${progress.toFixed(3)}%` } as CSSProperties;
};
