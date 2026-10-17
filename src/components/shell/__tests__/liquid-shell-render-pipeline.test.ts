import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { renderShellLayers } from '../liquid-shell-render-pipeline';

describe('renderShellLayers', () => {
  it('draws the background layer, then the overlay layer, without post-processing', () => {
    // Regression for LD-01 and FE-02: the old pipeline's raw GLSL 3 shaders failed to compile
    // and its blur passes were never sampled, so nothing reached the screen.
    const renderer = { autoClear: true, clear: vi.fn(), clearDepth: vi.fn() };
    const camera = new THREE.OrthographicCamera();
    camera.layers.enableAll();
    const before = camera.layers.mask;
    const seenLayers: number[] = [];
    const nativeRender = vi.fn((_scene: THREE.Object3D, c: THREE.Camera) => {
      seenLayers.push(c.layers.mask);
      expect(renderer.autoClear).toBe(false);
    });

    renderShellLayers(renderer, new THREE.Scene(), camera, nativeRender);

    expect(seenLayers).toEqual([1 << 0, 1 << 1]);
    expect(renderer.clear).toHaveBeenCalledTimes(1);
    expect(renderer.clearDepth).toHaveBeenCalledTimes(1);
    expect(camera.layers.mask).toBe(before);
    expect(renderer.autoClear).toBe(true);
  });
});
