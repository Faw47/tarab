import type { CanvasProps } from '@react-three/fiber';

/** Match liquid `TopBar` strip height (`h-14` = 3.5rem) for WebGL header plane. */
export const LIQUID_HEADER_STRIP_PX = 56;

export const liquidShellGl: CanvasProps['gl'] = {
  alpha: true,
  antialias: false,
  powerPreference: 'low-power',
};

export const liquidShellOrthoCamera = {
  position: [0, 0, 1] as [number, number, number],
  zoom: 1,
  near: 0.1,
  far: 10,
};
