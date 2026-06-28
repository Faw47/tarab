/**
 * Spring-smoothed pill motion + lightweight FSM (`idle | hover | press | drag | settle`) for GPU glass.
 * Feeds `useLiquidControlGlassStore` with pixel-space uniforms for the shell composite pass.
 */
import { useEffect, useRef, type RefObject } from 'react';

import { readLiquidGlassDebugExaggerated } from '@/lib/liquid-glass-debug';
import {
  type LiquidGlassInteractionPhase,
  useLiquidControlGlassStore,
} from '@/store/liquid-control-glass-store';

import type { LiquidPillHorizontal, LiquidPillHorizontalGeom } from './use-liquid-segmented-pill';

type HorizontalMotionOpts = {
  enabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
  pillStyle: LiquidPillHorizontal;
  pillLayoutFromDom: boolean;
  pillGeometryRef: RefObject<LiquidPillHorizontalGeom | null>;
  isDragging: boolean;
  hoveringRef: RefObject<boolean>;
  pressingRef: RefObject<boolean>;
  activeIndex: number;
};

const PILL_INSET_Y = 4;

function resolvePhase(
  isDragging: boolean,
  pressing: boolean,
  hovering: boolean,
  settleUntil: number,
  now: number,
): LiquidGlassInteractionPhase {
  if (isDragging) return 'drag';
  if (pressing) return 'press';
  if (now < settleUntil) return 'settle';
  if (hovering) return 'hover';
  return 'idle';
}

export function useLiquidControlMotionHorizontal(options: HorizontalMotionOpts): void {
  const {
    enabled,
    rootRef,
    pillStyle,
    pillLayoutFromDom,
    pillGeometryRef,
    isDragging,
    hoveringRef,
    pressingRef,
    activeIndex,
  } = options;

  const springRef = useRef({ left: 0, width: 0 });
  const prevTargetLeftRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const velEmaRef = useRef(0);
  const morphRef = useRef(1);
  const prevIndexRef = useRef(activeIndex);
  const settleUntilRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      useLiquidControlGlassStore.getState().setTabStripActive(false);
      useLiquidControlGlassStore.getState().resetPill();
      return;
    }

    useLiquidControlGlassStore.getState().setTabStripActive(true);

    let raf = 0;
    const tick = (now: number) => {
      const root = rootRef.current;
      const canvas = document.querySelector(
        '[data-liquid-shell-canvas]',
      ) as HTMLCanvasElement | null;
      const setPill = useLiquidControlGlassStore.getState().setPill;
      const setDebug = useLiquidControlGlassStore.getState().setDebugExaggerated;

      setDebug(readLiquidGlassDebugExaggerated());

      if (!root || !canvas) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const debug = readLiquidGlassDebugExaggerated();
      const dbg = debug ? 2.4 : 1;

      const targetLeft = pillLayoutFromDom
        ? (pillGeometryRef.current?.left ?? pillStyle.left)
        : pillStyle.left;
      const targetWidth = pillLayoutFromDom
        ? (pillGeometryRef.current?.width ?? pillStyle.width)
        : pillStyle.width;

      const visible = pillStyle.opacity > 0.01 || pillLayoutFromDom;
      if (!visible || targetWidth <= 0.5) {
        setPill({ visible: false });
        raf = requestAnimationFrame(tick);
        return;
      }

      if (prevIndexRef.current !== activeIndex) {
        morphRef.current = 0;
        prevIndexRef.current = activeIndex;
        settleUntilRef.current = now + 220;
      }

      const dt = Math.min(0.045, Math.max(1 / 120, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;
      morphRef.current = Math.min(1, morphRef.current + dt * 4.5);

      const k = 22;
      const alpha = 1 - Math.exp(-k * dt);
      const s = springRef.current;
      if (s.width < 0.01 && targetWidth > 0.5) {
        s.left = targetLeft;
        s.width = targetWidth;
        prevTargetLeftRef.current = targetLeft;
      }
      s.left += (targetLeft - s.left) * alpha;
      s.width += (targetWidth - s.width) * alpha;

      const rawVx = (targetLeft - prevTargetLeftRef.current) / Math.max(1e-4, dt);
      prevTargetLeftRef.current = targetLeft;
      velEmaRef.current = velEmaRef.current * 0.82 + rawVx * 0.18;

      const stretchX = Math.max(-0.12, Math.min(0.12, velEmaRef.current * 0.0012)) * dbg;
      const stretchY = isDragging ? -0.03 * dbg : 0;

      const hovering = hoveringRef.current === true;
      const pressing = pressingRef.current === true;
      const phase = resolvePhase(isDragging, pressing, hovering, settleUntilRef.current, now);

      let halfHScale = 1;
      if (phase === 'press') halfHScale = 0.92;
      if (phase === 'drag') halfHScale = 0.96;

      const rootRect = root.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const bufW = canvas.width;
      const bufH = canvas.height;
      const scaleX = bufW / Math.max(1, canvasRect.width);
      const scaleY = bufH / Math.max(1, canvasRect.height);

      const pillHCss = Math.max(8, rootRect.height - PILL_INSET_Y * 2);
      const pillW = s.width * scaleX;
      const pillH = pillHCss * scaleY * halfHScale;

      const leftCanvas = (rootRect.left + s.left - canvasRect.left) * scaleX;
      const topCanvasCss = rootRect.top + PILL_INSET_Y - canvasRect.top;
      const topCanvas = topCanvasCss * scaleY;

      const bottomGl = bufH - (topCanvas + pillH);
      const centerX = leftCanvas + pillW * 0.5;
      const centerY = bottomGl + pillH * 0.5;

      const radiusPx = Math.min(pillW, pillH) * 0.5;

      setPill({
        visible: true,
        centerPx: [centerX, centerY],
        halfSizePx: [(pillW * (1 + stretchX)) * 0.5, (pillH * (1 + stretchY)) * 0.5],
        radiusPx,
        stretchX,
        stretchY,
        morphT: morphRef.current,
        phase,
        velocityPx: [velEmaRef.current, 0],
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      useLiquidControlGlassStore.getState().setTabStripActive(false);
      useLiquidControlGlassStore.getState().resetPill();
    };
  }, [
    enabled,
    rootRef,
    pillStyle.left,
    pillStyle.width,
    pillStyle.opacity,
    pillLayoutFromDom,
    pillGeometryRef,
    isDragging,
    hoveringRef,
    pressingRef,
    activeIndex,
  ]);
}
