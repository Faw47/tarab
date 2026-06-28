/**
 * Pure geometry for liquid segmented controls: segment layout, interpolation along the span,
 * hit-testing, and pointer position in root content coordinates.
 * Selection / pointer capture lives in `useLiquidSegmentedPill*`.
 */

export type LiquidSegment = { offset: number; size: number };

export const liquidSegmentedClamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function readLiquidSegments(
  root: HTMLElement,
  selector: string,
  orientation: 'horizontal' | 'vertical',
): LiquidSegment[] {
  const rootRect = root.getBoundingClientRect();
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return nodes.map((el) => {
    const r = el.getBoundingClientRect();
    if (orientation === 'horizontal') {
      return { offset: r.left - rootRect.left, size: r.width };
    }
    return { offset: r.top - rootRect.top, size: r.height };
  });
}

export function liquidContentX(root: HTMLElement, clientX: number): number {
  return clientX - root.getBoundingClientRect().left;
}

export function liquidContentY(root: HTMLElement, clientY: number): number {
  return clientY - root.getBoundingClientRect().top;
}

export function interpolateLiquidHorizontal(
  segments: LiquidSegment[],
  pos: number,
): { left: number; width: number } {
  if (segments.length === 0) return { left: 0, width: 0 };
  if (segments.length === 1) {
    const s = segments[0];
    return { left: s.offset, width: s.size };
  }
  const spanStart = segments[0].offset;
  const last = segments[segments.length - 1];
  const spanEnd = last.offset + last.size;
  const denom = spanEnd - spanStart;
  const t = denom <= 0 ? 0 : liquidSegmentedClamp((pos - spanStart) / denom, 0, 1);
  const floatIndex = t * (segments.length - 1);
  const i = liquidSegmentedClamp(Math.floor(floatIndex), 0, segments.length - 2);
  const frac = floatIndex - i;
  const a = segments[i];
  const b = segments[i + 1];
  return {
    left: a.offset + frac * (b.offset - a.offset),
    width: a.size + frac * (b.size - a.size),
  };
}

export function nearestLiquidIndexHorizontal(segments: LiquidSegment[], pos: number): number {
  if (segments.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  segments.forEach((s, i) => {
    const mid = s.offset + s.size / 2;
    const d = Math.abs(pos - mid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Tab index whose bounds contain the pointer (inclusive). */
export function hitTestLiquidHorizontal(segments: LiquidSegment[], pos: number): number {
  if (segments.length === 0) return 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (pos >= s.offset && pos <= s.offset + s.size) return i;
  }
  return nearestLiquidIndexHorizontal(segments, pos);
}

export function interpolateLiquidVertical(
  segments: LiquidSegment[],
  pos: number,
): { top: number; height: number } {
  if (segments.length === 0) return { top: 0, height: 0 };
  if (segments.length === 1) {
    const s = segments[0];
    return { top: s.offset, height: s.size };
  }
  const spanStart = segments[0].offset;
  const last = segments[segments.length - 1];
  const spanEnd = last.offset + last.size;
  const denom = spanEnd - spanStart;
  const t = denom <= 0 ? 0 : liquidSegmentedClamp((pos - spanStart) / denom, 0, 1);
  const floatIndex = t * (segments.length - 1);
  const i = liquidSegmentedClamp(Math.floor(floatIndex), 0, segments.length - 2);
  const frac = floatIndex - i;
  const a = segments[i];
  const b = segments[i + 1];
  return {
    top: a.offset + frac * (b.offset - a.offset),
    height: a.size + frac * (b.size - a.size),
  };
}

export function nearestLiquidIndexVertical(segments: LiquidSegment[], pos: number): number {
  if (segments.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  segments.forEach((s, i) => {
    const mid = s.offset + s.size / 2;
    const d = Math.abs(pos - mid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function hitTestLiquidVertical(segments: LiquidSegment[], pos: number): number {
  if (segments.length === 0) return 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (pos >= s.offset && pos <= s.offset + s.size) return i;
  }
  return nearestLiquidIndexVertical(segments, pos);
}
