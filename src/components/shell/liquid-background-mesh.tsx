import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  liquidBackgroundFragmentShader,
  liquidBackgroundVertexShader,
} from './liquid-background-shaders';

/**
 * A CSS color as raw RGB for the shell shaders. Their output is written to the canvas without a
 * color-space conversion, so the CSS values pass through as they are instead of being linearized
 * (which made the palette several times darker). Alpha in rgba() strings is not used.
 */
export function shaderColor(css: string): THREE.Color {
  return new THREE.Color().setStyle(css, THREE.LinearSRGBColorSpace);
}

export type LiquidBgColors = Record<'b1' | 'b2' | 'b3' | 'b4' | 'b5', string>;

export function LiquidBackgroundPlane({
  colors,
  pauseAnimation,
}: {
  colors: LiquidBgColors;
  pauseAnimation: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useLayoutEffect(() => {
    meshRef.current?.layers.set(0);
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      color1: { value: shaderColor(colors.b1) },
      color2: { value: shaderColor(colors.b2) },
      color3: { value: shaderColor(colors.b3) },
      color4: { value: shaderColor(colors.b4) },
      color5: { value: shaderColor(colors.b5) },
    }),
    [colors],
  );

  useFrame((_, delta) => {
    if (!materialRef.current || pauseAnimation) return;
    const speed = 0.15;
    // Clamped so resuming after a pause does not jump the animation.
    materialRef.current.uniforms.uTime.value += Math.min(delta, 0.1) * speed;
  });

  return (
    <mesh ref={meshRef} renderOrder={0}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={liquidBackgroundVertexShader}
        fragmentShader={liquidBackgroundFragmentShader}
        uniforms={uniforms}
        depthWrite={false}
      />
    </mesh>
  );
}
