import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  liquidBackgroundFragmentShader,
  liquidBackgroundVertexShader,
} from './liquid-background-shaders';

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
      color1: { value: new THREE.Color(colors.b1) },
      color2: { value: new THREE.Color(colors.b2) },
      color3: { value: new THREE.Color(colors.b3) },
      color4: { value: new THREE.Color(colors.b4) },
      color5: { value: new THREE.Color(colors.b5) },
    }),
    [colors],
  );

  useFrame((state) => {
    if (!materialRef.current || pauseAnimation) return;
    const speed = 0.15;
    materialRef.current.uniforms.uTime.value += state.clock.getDelta() * speed;
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
