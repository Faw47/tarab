/**
 * Bridge from DOM liquid controls to a future same-canvas composite surface.
 *
 * The live shell intentionally uses direct rendering and keeps no offscreen
 * render targets. These interaction values remain isolated here so a future
 * composite can be added without making DOM controls own shell state.
 */
import { create } from 'zustand';

export type LiquidGlassInteractionPhase = 'idle' | 'hover' | 'press' | 'drag' | 'settle';

export type LiquidGlassPillUniforms = {
  visible: boolean;
  /** Bitmap pixel space, origin bottom-left (matches `gl_FragCoord`). */
  centerPx: readonly [number, number];
  halfSizePx: readonly [number, number];
  radiusPx: number;
  stretchX: number;
  stretchY: number;
  morphT: number;
  phase: LiquidGlassInteractionPhase;
  velocityPx: readonly [number, number];
};

export type LiquidControlGlassState = {
  /** Primary nav strip drives the only v1 consumer (`SlidingTabGroup`). */
  tabStripActive: boolean;
  pill: LiquidGlassPillUniforms;
  /** Multiplier for stretch / refraction / glare / dispersion when debug is on. */
  debugExaggerated: boolean;
  setTabStripActive: (active: boolean) => void;
  setPill: (partial: Partial<LiquidGlassPillUniforms>) => void;
  setDebugExaggerated: (v: boolean) => void;
  resetPill: () => void;
};

const defaultPill: LiquidGlassPillUniforms = {
  visible: false,
  centerPx: [0, 0],
  halfSizePx: [0, 0],
  radiusPx: 8,
  stretchX: 0,
  stretchY: 0,
  morphT: 1,
  phase: 'idle',
  velocityPx: [0, 0],
};

export const useLiquidControlGlassStore = create<LiquidControlGlassState>((set) => ({
  tabStripActive: false,
  pill: defaultPill,
  debugExaggerated: false,
  setTabStripActive: (active) => set({ tabStripActive: active }),
  setPill: (partial) =>
    set((s) => ({
      pill: { ...s.pill, ...partial },
    })),
  setDebugExaggerated: (v) => set({ debugExaggerated: v }),
  resetPill: () => set({ pill: defaultPill, tabStripActive: false }),
}));
