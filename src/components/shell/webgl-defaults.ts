import type { CanvasProps } from '@react-three/fiber';

/** Match liquid `TopBar` strip height (`h-14` = 3.5rem) for WebGL header plane. */
export const LIQUID_HEADER_STRIP_PX = 56;

export const liquidShellGl: CanvasProps['gl'] = {
  alpha: true,
  antialias: false,
  powerPreference: 'low-power',
};

/**
 * The shell planes are laid out in a -1..1 view. An explicit frustum makes R3F treat the camera as
 * manual; its default orthographic frustum is in pixels, which shrank the 2x2 background plane to
 * two pixels.
 */
export const liquidShellOrthoCamera = {
  left: -1,
  right: 1,
  top: 1,
  bottom: -1,
  position: [0, 0, 1] as [number, number, number],
  zoom: 1,
  near: 0.1,
  far: 10,
};
