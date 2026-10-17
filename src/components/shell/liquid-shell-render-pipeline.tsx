/**
 * Renders the liquid shell in two passes inside the single R3F Canvas: layer 0 (metaballs), then
 * layer 1 (aurora and particles) on top with a fresh depth buffer.
 *
 * This replaced a render-target pipeline whose blur passes were never sampled and whose
 * `#version 300 es` raw shaders failed to compile under three.js (its prepended defines moved the
 * directive off the first line), so it drew nothing.
 */

import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type * as THREE from 'three';

interface LayerRenderer {
  autoClear: boolean;
  clear: (color?: boolean, depth?: boolean, stencil?: boolean) => void;
  clearDepth: () => void;
}

export function renderShellLayers(
  renderer: LayerRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  nativeRender: (s: THREE.Object3D, c: THREE.Camera) => void,
) {
  const previousMask = camera.layers.mask;
  const previousAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.clear(true, true, true);

  camera.layers.set(0);
  nativeRender(scene, camera);

  renderer.clearDepth();
  camera.layers.set(1);
  nativeRender(scene, camera);

  camera.layers.mask = previousMask;
  renderer.autoClear = previousAutoClear;
}

export function LiquidShellRenderPipeline() {
  const gl = useThree((s) => s.gl);

  useLayoutEffect(() => {
    const nativeRender = gl.render.bind(gl);
    gl.render = (scene, camera) => {
      renderShellLayers(gl, scene, camera, nativeRender);
    };
    return () => {
      gl.render = nativeRender;
    };
  }, [gl]);

  return null;
}
