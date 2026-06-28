import { useEffect, useRef, useState } from 'react';
import { getCoverArtPalette } from '../lib/tauri-commands';

interface ExtractedColors {
  primary: string;
  secondary: string;
  background: string;
  gradient: string;
  accentRgb: string;
}

const DEFAULT_COLORS: ExtractedColors = {
  primary: '#38bdf8',
  secondary: '#f472b6',
  background: '#0a0a0a',
  gradient:
    'linear-gradient(180deg, rgba(56, 189, 248, 0.2) 0%, rgba(10, 10, 10, 0.95) 60%, rgba(10, 10, 10, 1) 100%)',
  accentRgb: '56, 189, 248',
};

const MAX_COLOR_CACHE = 200;
const colorCache = new Map<string, ExtractedColors>();

/**
 * Parse hex color to RGB values
 */
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 100, g: 100, b: 100 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
};

/**
 * Convert RGB to HSL
 */
const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
};

/**
 * Build the gradient from extracted colors
 */
const buildGradient = (primaryHex: string, secondaryHex: string): ExtractedColors => {
  const primary = hexToRgb(primaryHex);
  const secondary = hexToRgb(secondaryHex);

  const [h1, s1] = rgbToHsl(primary.r, primary.g, primary.b);
  const [h2] = rgbToHsl(secondary.r, secondary.g, secondary.b);

  // Create a rich vertical gradient - Spotify style
  const gradient = `linear-gradient(180deg, 
    hsla(${h1}, ${Math.min(s1, 65)}%, 30%, 0.95) 0%, 
    hsla(${h1}, ${Math.min(s1, 50)}%, 20%, 0.97) 30%,
    hsla(${h2}, 35%, 12%, 0.98) 60%,
    rgba(10, 10, 10, 1) 100%)`;

  return {
    primary: primaryHex,
    secondary: secondaryHex,
    background: `hsla(${h1}, ${Math.min(s1, 40)}%, 10%, 1)`,
    gradient,
    accentRgb: `${primary.r}, ${primary.g}, ${primary.b}`,
  };
};

/**
 * Hook to extract dominant colors from a track's cover art using the Tauri backend
 */
export const useColorExtraction = (filePath: string | null | undefined): ExtractedColors => {
  const [colors, setColors] = useState<ExtractedColors>(DEFAULT_COLORS);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!filePath) {
      setColors(DEFAULT_COLORS);
      return;
    }

    // Check cache first
    if (colorCache.has(filePath)) {
      setColors(colorCache.get(filePath)!);
      return;
    }

    abortRef.current = false;

    // Use the Tauri backend for color extraction
    getCoverArtPalette(filePath)
      .then((palette) => {
        if (abortRef.current) return;

        if (palette && palette.primary && palette.secondary) {
          const extracted = buildGradient(palette.primary, palette.secondary);
          if (colorCache.size >= MAX_COLOR_CACHE) {
            const first = colorCache.keys().next().value;
            if (first !== undefined) colorCache.delete(first);
          }
          colorCache.set(filePath, extracted);
          setColors(extracted);
        } else {
          setColors(DEFAULT_COLORS);
        }
      })
      .catch((err) => {
        console.warn('Failed to get cover art palette:', err);
        if (!abortRef.current) {
          setColors(DEFAULT_COLORS);
        }
      });

    return () => {
      abortRef.current = true;
    };
  }, [filePath]);

  return colors;
};

export type { ExtractedColors };
