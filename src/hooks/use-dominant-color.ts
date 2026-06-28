import { useEffect, useRef, useState } from 'react';

/**
 * Canvas 1×1 sampling for a local accent fallback (e.g. ambient radial blooms).
 */
export const useDominantColor = (imageUrl: string | null): string => {
  const [color, setColor] = useState<string>('var(--hero-accent, var(--color-primary))');
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (imgRef.current) {
      imgRef.current.onload = null;
      imgRef.current.onerror = null;
      imgRef.current = null;
    }
    if (!imageUrl) {
      setColor('var(--hero-accent, var(--color-primary))');
      return;
    }
    const img = new Image();
    imgRef.current = img;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        setColor(`rgb(${r},${g},${b})`);
      } catch {
        setColor('var(--hero-accent, var(--color-primary))');
      }
    };
    img.onerror = () => setColor('var(--hero-accent, var(--color-primary))');
    img.src = imageUrl;
    return () => {
      if (imgRef.current) {
        imgRef.current.onload = null;
        imgRef.current.onerror = null;
        imgRef.current = null;
      }
    };
  }, [imageUrl]);

  return color;
};
