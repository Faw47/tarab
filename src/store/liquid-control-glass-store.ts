/**
 * Bridge from DOM liquid controls → shell WebGL pill composite.
 *
 * Limitation (v1): `u_bg` / `u_blurredBg` sample the liquid shell render targets (metaball layer + blur),
 * not arbitrary TopBar HTML/text. Coherent refraction against the shell backdrop only.
 *
 * Pass graph (same R3F Canvas): RT raw background → separable Gaussian blur → composite pill samples raw+blur.
 * Pill uses rounded-rect SDF, gradient normals → refraction UVs, RGB dispersion, Fresnel/glare; motion uniforms
 * come from spring + FSM (velocity stretch, press squash) in `useLiquidControlMotion`.
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
