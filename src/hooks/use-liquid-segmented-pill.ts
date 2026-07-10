import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  hitTestLiquidHorizontal,
  hitTestLiquidVertical,
  interpolateLiquidHorizontal,
  interpolateLiquidVertical,
  liquidContentX,
  liquidContentY,
  liquidSegmentedClamp,
  nearestLiquidIndexHorizontal,
  nearestLiquidIndexVertical,
  readLiquidSegments,
} from '@/lib/liquid-segmented-geometry';

const MOVE_THRESHOLD_PX = 3;

function clearHorizontalPillDom(el: HTMLElement | null) {
  if (!el) return;
  el.style.left = '';
  el.style.width = '';
  el.style.opacity = '';
}

function clearVerticalPillDom(el: HTMLElement | null) {
  if (!el) return;
  el.style.top = '';
  el.style.height = '';
  el.style.opacity = '';
}

export function applyHorizontalPillDom(el: HTMLElement, left: number, width: number) {
  el.style.left = `${left}px`;
  el.style.width = `${width}px`;
  el.style.opacity = '1';
}

export function applyVerticalPillDom(el: HTMLElement, top: number, height: number) {
  el.style.top = `${top}px`;
  el.style.height = `${height}px`;
  el.style.opacity = '1';
}

export type LiquidPillHorizontal = { left: number; width: number; opacity: number };
export type LiquidPillVertical = { top: number; height: number; opacity: number };

export type LiquidPillHorizontalGeom = { left: number; width: number };
export type LiquidPillVerticalGeom = { top: number; height: number };

type HorizontalDrag = {
  pointerId: number;
  originX: number;
  hasMovedPill: boolean;
};

type VerticalDrag = {
  pointerId: number;
  originY: number;
  hasMovedPill: boolean;
};

const noopPointer = (_e?: ReactPointerEvent<HTMLElement>) => {};

export function useLiquidSegmentedPillHorizontal(options: {
  rootRef: RefObject<HTMLElement | null>;
  pillElementRef: RefObject<HTMLElement | null>;
  tabSelector: string;
  activeIndex: number;
  onCommitIndex: (index: number) => void;
  syncDependencies: readonly unknown[];
  enabled?: boolean;
}): {
  pillStyle: LiquidPillHorizontal;
  isDragging: boolean;
  /** While dragging after threshold: pill position is written on pillElementRef — omit left/width/opacity from React style. */
  pillLayoutFromDom: boolean;
  dragPreviewIndex: number | null;
  pillGeometryRef: RefObject<LiquidPillHorizontalGeom | null>;
  suppressNextTabClickRef: RefObject<boolean>;
  listProps: {
    onPointerDownCapture: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUpCapture: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancelCapture: (e: ReactPointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => void;
  };
} {
  const {
    rootRef,
    pillElementRef,
    tabSelector,
    activeIndex,
    onCommitIndex,
    syncDependencies,
    enabled = true,
  } = options;
  const [pillStyle, setPillStyle] = useState<LiquidPillHorizontal>({
    left: 0,
    width: 0,
    opacity: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [pillLayoutFromDom, setPillLayoutFromDom] = useState(false);
  const [dragPreviewIndex, setDragPreviewIndex] = useState<number | null>(null);
  const suppressNextTabClickRef = useRef(false);
  const dragRef = useRef<HorizontalDrag | null>(null);
  const sessionRef = useRef(false);
  const pillGeometryRef = useRef<LiquidPillHorizontalGeom | null>(null);

  const applyCommittedPill = useCallback(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;
    const segments = readLiquidSegments(root, tabSelector, 'horizontal');
    if (segments.length === 0) {
      setPillStyle((p) => ({ ...p, opacity: 0 }));
      return;
    }
    const idx = liquidSegmentedClamp(activeIndex, 0, segments.length - 1);
    const s = segments[idx];
    setPillStyle({ left: s.offset, width: s.size, opacity: 1 });
  }, [enabled, rootRef, tabSelector, activeIndex]);

  useEffect(() => {
    if (!enabled) {
      setPillStyle({ left: 0, width: 0, opacity: 0 });
      return;
    }
    if (sessionRef.current || pillLayoutFromDom) return;
    applyCommittedPill();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncDependencies bundles external triggers
  }, [enabled, applyCommittedPill, pillLayoutFromDom, ...syncDependencies]);

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;

    const schedule = () => {
      if (sessionRef.current || pillLayoutFromDom) return;
      applyCommittedPill();
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(root);
    root.querySelectorAll(tabSelector).forEach((el) => resizeObserver.observe(el));
    window.addEventListener('resize', schedule);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [enabled, rootRef, tabSelector, applyCommittedPill, pillLayoutFromDom]);

  const finishDrag = useCallback(
    (root: HTMLElement, clientPos: number, hasMovedPill: boolean) => {
      const segments = readLiquidSegments(root, tabSelector, 'horizontal');
      if (segments.length === 0) return;
      const x = liquidContentX(root, clientPos);
      const idx = nearestLiquidIndexHorizontal(segments, x);
      const s = segments[idx];

      if (hasMovedPill) {
        clearHorizontalPillDom(pillElementRef.current);
      }
      pillGeometryRef.current = null;

      sessionRef.current = false;
      setPillLayoutFromDom(false);
      setIsDragging(false);
      setDragPreviewIndex(null);
      suppressNextTabClickRef.current = true;
      onCommitIndex(idx);
      setPillStyle({ left: s.offset, width: s.size, opacity: 1 });
    },
    [tabSelector, onCommitIndex, pillElementRef],
  );

  const listProps = {
    onPointerDownCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      const root = rootRef.current;
      if (!root || !root.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

      sessionRef.current = true;
      pillGeometryRef.current = null;
      dragRef.current = {
        pointerId: e.pointerId,
        originX: liquidContentX(root, e.clientX),
        hasMovedPill: false,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        sessionRef.current = false;
        dragRef.current = null;
        return;
      }
    },

    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const drag = dragRef.current;
      const root = rootRef.current;
      const pillEl = pillElementRef.current;
      if (!drag || !root || !pillEl || e.pointerId !== drag.pointerId) return;

      const x = liquidContentX(root, e.clientX);
      if (!drag.hasMovedPill) {
        if (Math.abs(x - drag.originX) < MOVE_THRESHOLD_PX) return;
        drag.hasMovedPill = true;
        setIsDragging(true);
        setPillLayoutFromDom(true);
      }

      const segments = readLiquidSegments(root, tabSelector, 'horizontal');
      if (segments.length === 0) return;
      const pill = interpolateLiquidHorizontal(segments, x);
      pillGeometryRef.current = { left: pill.left, width: pill.width };
      applyHorizontalPillDom(pillEl, pill.left, pill.width);
      setDragPreviewIndex(hitTestLiquidHorizontal(segments, x));
    },

    onPointerUpCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const hasMovedPill = drag.hasMovedPill;
      dragRef.current = null;
      const root = rootRef.current;
      if (!root) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (!sessionRef.current) return;
      finishDrag(root, e.clientX, hasMovedPill);
    },

    onPointerCancelCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const hasMovedPill = drag.hasMovedPill;
      dragRef.current = null;
      const root = rootRef.current;
      if (!root) return;
      if (!sessionRef.current) return;
      finishDrag(root, e.clientX, hasMovedPill);
    },

    onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const hasMovedPill = drag.hasMovedPill;
      dragRef.current = null;
      const root = rootRef.current;
      if (!root) return;
      if (!sessionRef.current) return;
      finishDrag(root, e.clientX, hasMovedPill);
    },
  };

  if (!enabled) {
    return {
      pillStyle: { left: 0, width: 0, opacity: 0 },
      isDragging: false,
      pillLayoutFromDom: false,
      dragPreviewIndex: null,
      pillGeometryRef,
      suppressNextTabClickRef,
      listProps: {
        onPointerDownCapture: noopPointer,
        onPointerMove: noopPointer,
        onPointerUpCapture: noopPointer,
        onPointerCancelCapture: noopPointer,
        onLostPointerCapture: noopPointer,
      },
    };
  }

  return {
    pillStyle,
    isDragging,
    pillLayoutFromDom,
    dragPreviewIndex,
    pillGeometryRef,
    suppressNextTabClickRef,
    listProps,
  };
}

export function useLiquidSegmentedPillVertical(options: {
  rootRef: RefObject<HTMLElement | null>;
  pillElementRef: RefObject<HTMLElement | null>;
  tabSelector: string;
  activeIndex: number;
  onCommitIndex: (index: number) => void;
  syncDependencies: readonly unknown[];
  enabled?: boolean;
}): {
  pillStyle: LiquidPillVertical;
  isDragging: boolean;
  pillLayoutFromDom: boolean;
  dragPreviewIndex: number | null;
  pillGeometryRef: RefObject<LiquidPillVerticalGeom | null>;
  suppressNextTabClickRef: RefObject<boolean>;
  listProps: {
    onPointerDownCapture: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUpCapture: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancelCapture: (e: ReactPointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => void;
  };
} {
  const {
    rootRef,
    pillElementRef,
    tabSelector,
    activeIndex,
    onCommitIndex,
    syncDependencies,
    enabled = true,
  } = options;
  const [pillStyle, setPillStyle] = useState<LiquidPillVertical>({ top: 0, height: 0, opacity: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [pillLayoutFromDom, setPillLayoutFromDom] = useState(false);
  const [dragPreviewIndex, setDragPreviewIndex] = useState<number | null>(null);
  const suppressNextTabClickRef = useRef(false);
  const dragRef = useRef<VerticalDrag | null>(null);
  const sessionRef = useRef(false);
  const pillGeometryRef = useRef<LiquidPillVerticalGeom | null>(null);

  const applyCommittedPill = useCallback(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;
    const segments = readLiquidSegments(root, tabSelector, 'vertical');
    if (segments.length === 0) {
      setPillStyle((p) => ({ ...p, opacity: 0 }));
      return;
    }
    const idx = liquidSegmentedClamp(activeIndex, 0, segments.length - 1);
    const s = segments[idx];
    setPillStyle({ top: s.offset, height: s.size, opacity: 1 });
  }, [enabled, rootRef, tabSelector, activeIndex]);

  useEffect(() => {
    if (!enabled) {
      setPillStyle({ top: 0, height: 0, opacity: 0 });
      return;
    }
    if (sessionRef.current || pillLayoutFromDom) return;
    applyCommittedPill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, applyCommittedPill, pillLayoutFromDom, ...syncDependencies]);

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;

    const schedule = () => {
      if (sessionRef.current || pillLayoutFromDom) return;
      applyCommittedPill();
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(root);
    root.querySelectorAll(tabSelector).forEach((el) => resizeObserver.observe(el));
    window.addEventListener('resize', schedule);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [enabled, rootRef, tabSelector, applyCommittedPill, pillLayoutFromDom]);

  const finishDrag = useCallback(
    (root: HTMLElement, clientPos: number, hasMovedPill: boolean) => {
      const segments = readLiquidSegments(root, tabSelector, 'vertical');
      if (segments.length === 0) return;
      const y = liquidContentY(root, clientPos);
      const idx = nearestLiquidIndexVertical(segments, y);
      const s = segments[idx];

      if (hasMovedPill) {
        clearVerticalPillDom(pillElementRef.current);
      }
      pillGeometryRef.current = null;

      sessionRef.current = false;
      setPillLayoutFromDom(false);
      setIsDragging(false);
      setDragPreviewIndex(null);
      suppressNextTabClickRef.current = true;
      onCommitIndex(idx);
      setPillStyle({ top: s.offset, height: s.size, opacity: 1 });
    },
    [tabSelector, onCommitIndex, pillElementRef],
  );

  const listProps = {
    onPointerDownCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      const root = rootRef.current;
      if (!root || !root.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

      sessionRef.current = true;
      pillGeometryRef.current = null;
      dragRef.current = {
        pointerId: e.pointerId,
        originY: liquidContentY(root, e.clientY),
        hasMovedPill: false,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        sessionRef.current = false;
        dragRef.current = null;
        return;
      }
    },

    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const drag = dragRef.current;
      const root = rootRef.current;
      const pillEl = pillElementRef.current;
      if (!drag || !root || !pillEl || e.pointerId !== drag.pointerId) return;

      const y = liquidContentY(root, e.clientY);
      if (!drag.hasMovedPill) {
        if (Math.abs(y - drag.originY) < MOVE_THRESHOLD_PX) return;
        drag.hasMovedPill = true;
        setIsDragging(true);
        setPillLayoutFromDom(true);
      }

      const segments = readLiquidSegments(root, tabSelector, 'vertical');
      if (segments.length === 0) return;
      const pill = interpolateLiquidVertical(segments, y);
      pillGeometryRef.current = { top: pill.top, height: pill.height };
      applyVerticalPillDom(pillEl, pill.top, pill.height);
      setDragPreviewIndex(hitTestLiquidVertical(segments, y));
    },

    onPointerUpCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const hasMovedPill = drag.hasMovedPill;
      dragRef.current = null;
      const root = rootRef.current;
      if (!root) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (!sessionRef.current) return;
      finishDrag(root, e.clientY, hasMovedPill);
    },

    onPointerCancelCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const hasMovedPill = drag.hasMovedPill;
      dragRef.current = null;
      const root = rootRef.current;
      if (!root) return;
      if (!sessionRef.current) return;
      finishDrag(root, e.clientY, hasMovedPill);
    },

    onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const hasMovedPill = drag.hasMovedPill;
      dragRef.current = null;
      const root = rootRef.current;
      if (!root) return;
      if (!sessionRef.current) return;
      finishDrag(root, e.clientY, hasMovedPill);
    },
  };

  if (!enabled) {
    return {
      pillStyle: { top: 0, height: 0, opacity: 0 },
      isDragging: false,
      pillLayoutFromDom: false,
      dragPreviewIndex: null,
      pillGeometryRef,
      suppressNextTabClickRef,
      listProps: {
        onPointerDownCapture: noopPointer,
        onPointerMove: noopPointer,
        onPointerUpCapture: noopPointer,
        onPointerCancelCapture: noopPointer,
        onLostPointerCapture: noopPointer,
      },
    };
  }

  return {
    pillStyle,
    isDragging,
    pillLayoutFromDom,
    dragPreviewIndex,
    pillGeometryRef,
    suppressNextTabClickRef,
    listProps,
  };
}
