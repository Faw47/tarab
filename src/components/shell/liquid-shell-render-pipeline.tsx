/**
 * Direct two-layer rendering for the single R3F shell canvas.
 *
 * The background and interaction layer render directly to the main canvas.
 * The old offscreen blur passes had no active consumer and added several
 * full-viewport draws per frame, so the shell intentionally keeps no render
 * targets or post-processing chain.
 */

import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import type * as THREE from 'three';

class LiquidShellPipeline {
  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  dispose(): void {
    // The direct renderer owns no GPU resources.
  }

  render(
    scene: THREE.Object3D,
    camera: THREE.Camera,
    nativeRender: (s: THREE.Object3D, c: THREE.Camera) => void,
  ): void {
    const previousMask = camera.layers.mask;
    camera.layers.enable(0);
    camera.layers.enable(1);
    try {
      this.renderer.setRenderTarget(null);
      this.renderer.setScissorTest(false);
      this.renderer.clear(true, true, true);
      nativeRender(scene, camera);
    } finally {
      camera.layers.mask = previousMask;
    }
  }
}
export function LiquidShellRenderPipeline() {
  const gl = useThree((s) => s.gl);
  const pipelineRef = useRef<LiquidShellPipeline | null>(null);

  useLayoutEffect(() => {
    const pipeline = new LiquidShellPipeline(gl);
    pipelineRef.current = pipeline;
    const nativeRender = gl.render.bind(gl);
    gl.render = (scene, camera) => {
      pipeline.render(scene, camera, nativeRender);
    };
    return () => {
      gl.render = nativeRender;
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, [gl]);

  return null;
}
