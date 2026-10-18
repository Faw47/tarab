import { describe, expect, it } from 'vitest';
import { shaderColor } from '../liquid-background-mesh';
import { liquidShellOrthoCamera } from '../webgl-defaults';

describe('liquid shell scene setup', () => {
  it('uses a -1..1 orthographic view so the 2x2 background plane fills the canvas', () => {
    // Regression for FE-01: R3F's default orthographic frustum is in pixels, which drew the
    // background plane two pixels wide.
    expect(liquidShellOrthoCamera).toMatchObject({ left: -1, right: 1, top: 1, bottom: -1 });
  });

  it('passes palette colors to the shaders without linearizing them', () => {
    const color = shaderColor('rgba(128, 64, 32, 0.5)');
    expect(color.r).toBeCloseTo(128 / 255, 3);
    expect(color.g).toBeCloseTo(64 / 255, 3);
    expect(color.b).toBeCloseTo(32 / 255, 3);
  });
});
