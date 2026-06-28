import { useEffect, useState } from 'react';
import { getCoverArtPalette } from '../lib/tauri-commands';

interface ReactivePaletteInput {
  filePath?: string | null;
  coverArtUrl?: string | null;
}

export interface ReactivePalette {
  shellBlobA: string;
  shellBlobB: string;
  heroAccent: string;
  heroGlow: string;
  surfaceTint: string;
  textContrastBias: number;
  secondaryAccent: string;
  liquidColors: {
    b1: string;
    b2: string;
    b3: string;
    b4: string;
    b5: string;
  };
  primaryRgb: string;
  secondaryRgb: string;
}

type RGB = {
  r: number;
  g: number;
  b: number;
};

const DEFAULT_RGB_PRIMARY: RGB = { r: 160, g: 118, b: 64 };
const DEFAULT_RGB_SECONDARY: RGB = { r: 86, g: 104, b: 58 };

const MAX_PALETTE_CACHE = 200;
const paletteCache = new Map<string, ReactivePalette>();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const mix = (a: RGB, b: RGB, weight = 0.5): RGB => ({
  r: Math.round(a.r + (b.r - a.r) * weight),
  g: Math.round(a.g + (b.g - a.g) * weight),
  b: Math.round(a.b + (b.b - a.b) * weight),
});

const darken = (rgb: RGB, factor: number, floor = 8): RGB => ({
  r: Math.max(floor, Math.round(rgb.r * factor)),
  g: Math.max(floor, Math.round(rgb.g * factor)),
  b: Math.max(floor, Math.round(rgb.b * factor)),
});

const brighten = (rgb: RGB, factor: number, lift = 18): RGB => ({
  r: clamp(Math.round(rgb.r * factor + lift), 0, 255),
  g: clamp(Math.round(rgb.g * factor + lift), 0, 255),
  b: clamp(Math.round(rgb.b * factor + lift), 0, 255),
});

const toRgb = (rgb: RGB) => `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
const toRgba = (rgb: RGB, alpha: number) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
const toRgbVar = (rgb: RGB) => `${rgb.r}, ${rgb.g}, ${rgb.b}`;

const parseHex = (hex: string): RGB | null => {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6) return null;

  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);

  if ([r, g, b].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { r, g, b };
};

const luminance = ({ r, g, b }: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const buildReactivePalette = (primaryBase: RGB, secondaryBase: RGB): ReactivePalette => {
  const shellBase = darken(primaryBase, 0.42, 10);
  const shellSecondary = darken(secondaryBase, 0.38, 10);
  const heroAccentRgb = brighten(primaryBase, 0.92, 32);
  const secondaryAccentRgb = brighten(mix(primaryBase, secondaryBase, 0.55), 0.85, 20);
  const shellMid = mix(shellBase, shellSecondary, 0.42);
  const contrastBias = clamp(0.7 + (1 - luminance(shellBase)) * 0.28, 0.74, 0.96);

  return {
    shellBlobA: toRgba(shellBase, 0.82),
    shellBlobB: toRgba(shellSecondary, 0.64),
    heroAccent: toRgb(heroAccentRgb),
    heroGlow: toRgba(heroAccentRgb, 0.36),
    surfaceTint: toRgba(mix(heroAccentRgb, shellSecondary, 0.38), 0.14),
    textContrastBias: Number(contrastBias.toFixed(3)),
    secondaryAccent: toRgb(secondaryAccentRgb),
    liquidColors: {
      b1: toRgba(shellBase, 0.78),
      b2: toRgba(shellSecondary, 0.64),
      b3: toRgba(shellMid, 0.5),
      b4: toRgba(darken(shellBase, 0.7), 0.6),
      b5: toRgba(brighten(shellSecondary, 1.1, 10), 0.5),
    },
    primaryRgb: toRgbVar(heroAccentRgb),
    secondaryRgb: toRgbVar(secondaryAccentRgb),
  };
};

const DEFAULT_REACTIVE_PALETTE = buildReactivePalette(DEFAULT_RGB_PRIMARY, DEFAULT_RGB_SECONDARY);

const sampleImage = async (
  coverArtUrl: string,
): Promise<{ primary: RGB; secondary: RGB } | null> => {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 12;
        canvas.height = 12;
        const context = canvas.getContext('2d');

        if (!context) {
          resolve(null);
          return;
        }

        context.drawImage(image, 0, 0, 12, 12);
        const data = context.getImageData(0, 0, 12, 12).data;

        const left = { r: 0, g: 0, b: 0, count: 0 };
        const right = { r: 0, g: 0, b: 0, count: 0 };

        for (let y = 0; y < 12; y += 1) {
          for (let x = 0; x < 12; x += 1) {
            const index = (y * 12 + x) * 4;
            const alpha = data[index + 3];
            if (alpha < 8) continue;

            const target = x < 6 ? left : right;
            target.r += data[index];
            target.g += data[index + 1];
            target.b += data[index + 2];
            target.count += 1;
          }
        }

        const average = (bucket: typeof left): RGB => ({
          r: Math.round(bucket.r / (bucket.count || 1)),
          g: Math.round(bucket.g / (bucket.count || 1)),
          b: Math.round(bucket.b / (bucket.count || 1)),
        });

        resolve({
          primary: average(left),
          secondary: average(right),
        });
      } catch {
        resolve(null);
      }
    };

    image.onerror = () => resolve(null);
    image.src = coverArtUrl;
  });
};

export const useReactivePalette = ({
  filePath,
  coverArtUrl,
}: ReactivePaletteInput): ReactivePalette => {
  const [palette, setPalette] = useState<ReactivePalette>(DEFAULT_REACTIVE_PALETTE);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = filePath || coverArtUrl || 'default';

    if (!filePath && !coverArtUrl) {
      setPalette(DEFAULT_REACTIVE_PALETTE);
      return;
    }

    if (paletteCache.has(cacheKey)) {
      setPalette(paletteCache.get(cacheKey)!);
      return;
    }

    const load = async () => {
      if (filePath) {
        try {
          const coverPalette = await getCoverArtPalette(filePath);
          if (cancelled) return;

          const primary = coverPalette?.primary ? parseHex(coverPalette.primary) : null;
          const secondary = coverPalette?.secondary ? parseHex(coverPalette.secondary) : null;

          if (primary && secondary) {
            const nextPalette = buildReactivePalette(primary, secondary);
            if (paletteCache.size >= MAX_PALETTE_CACHE) {
              const first = paletteCache.keys().next().value;
              if (first !== undefined) paletteCache.delete(first);
            }
            paletteCache.set(cacheKey, nextPalette);
            setPalette(nextPalette);
            return;
          }
        } catch {
          // Fall through to browser-side image sampling.
        }
      }

      if (coverArtUrl) {
        const sampled = await sampleImage(coverArtUrl);
        if (cancelled) return;

        if (sampled) {
          const nextPalette = buildReactivePalette(sampled.primary, sampled.secondary);
          if (paletteCache.size >= MAX_PALETTE_CACHE) {
            const first = paletteCache.keys().next().value;
            if (first !== undefined) paletteCache.delete(first);
          }
          paletteCache.set(cacheKey, nextPalette);
          setPalette(nextPalette);
          return;
        }
      }

      if (paletteCache.size >= MAX_PALETTE_CACHE) {
        const first = paletteCache.keys().next().value;
        if (first !== undefined) paletteCache.delete(first);
      }
      paletteCache.set(cacheKey, DEFAULT_REACTIVE_PALETTE);
      setPalette(DEFAULT_REACTIVE_PALETTE);
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [filePath, coverArtUrl]);

  return palette;
};
