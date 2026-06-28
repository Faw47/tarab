import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { memo, useMemo, useRef, useEffect, useState, useLayoutEffect } from 'react';
import * as THREE from 'three';

import { LiquidBackgroundPlane, type LiquidBgColors } from './liquid-background-mesh';
import { topBarAuroraVertexShader, topBarAuroraFragmentShader } from './header-aurora-shaders';
import { LiquidShellRenderPipeline } from './liquid-shell-render-pipeline';
import { liquidShellGl, liquidShellOrthoCamera, LIQUID_HEADER_STRIP_PX } from './webgl-defaults';
import { useDocumentHidden } from './use-document-hidden';

/* ─── AURORA COMPONENT ───────────────────────────────────────────────────── */

interface HeaderAuroraPlaneProps {
  accent: string;
  isScrolled: boolean;
  isFocused: boolean;
  pointerRef: React.MutableRefObject<{ x: number; y: number } | null>;
  pauseAnimation: boolean;
}

function HeaderAuroraPlane({
  accent,
  isScrolled,
  isFocused,
  pointerRef,
  pauseAnimation,
}: HeaderAuroraPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();

  useLayoutEffect(() => {
    meshRef.current?.layers.set(1);
  }, []);

  const accentColor = useMemo(() => new THREE.Color(accent), [accent]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uAccent: { value: accentColor },
      uScroll: { value: 0 },
      uFocus: { value: 0 },
      uPointer: { value: new THREE.Vector2(-1, -1) },
      uSweepStrength: { value: 0 },
    }),
    [accentColor, size.width, size.height],
  );

  useFrame((_, delta) => {
    if (!materialRef.current || pauseAnimation) return;

    const u = materialRef.current.uniforms;
    u.uTime.value += delta * 0.45;

    // Smooth transitions for interaction states
    u.uScroll.value = THREE.MathUtils.lerp(u.uScroll.value, isScrolled ? 1 : 0, 0.08);
    u.uFocus.value = THREE.MathUtils.lerp(u.uFocus.value, isFocused ? 1 : 0, 0.12);

    // Animate sweep on focus or randomly
    if (isFocused) {
      u.uSweepStrength.value = THREE.MathUtils.lerp(u.uSweepStrength.value, 1, 0.05);
    } else {
      u.uSweepStrength.value = THREE.MathUtils.lerp(u.uSweepStrength.value, 0, 0.03);
    }

    const ptr = pointerRef.current;
    if (ptr) {
      u.uPointer.value.set(ptr.x, 1.0 - ptr.y); // Flip Y for GL coords
    } else {
      u.uPointer.value.set(-1, -1);
    }
  });

  // Calculate position: fixed height strip at the top of the orthographic view
  // Ortho view is -1 to 1.
  const stripHeightView = (LIQUID_HEADER_STRIP_PX / size.height) * 2;
  const yPos = 1.0 - stripHeightView / 2;

  return (
    <mesh ref={meshRef} position={[0, yPos, 0.1]} renderOrder={1}>
      <planeGeometry args={[2, stripHeightView]} />
      <shaderMaterial
        ref={materialRef}
        transparent
        depthTest={false}
        depthWrite={false}
        vertexShader={topBarAuroraVertexShader}
        fragmentShader={topBarAuroraFragmentShader}
        uniforms={uniforms}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/* ─── PARTICLE BURST COMPONENT ────────────────────────────────────────────── */

function ScanBurstParticles({ burstKey }: { burstKey: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const [particles, setParticles] = useState<{ pos: Float32Array; vel: Float32Array } | null>(null);
  const startTime = useRef(0);

  useEffect(() => {
    if (burstKey === 0) return;

    const count = 120;
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Start randomly across top bar area
      pos[i3] = (Math.random() - 0.5) * 2;
      pos[i3 + 1] = 0.8 + Math.random() * 0.2;
      pos[i3 + 2] = 0.2;

      // Explosion velocity
      vel[i3] = (Math.random() - 0.5) * 0.02;
      vel[i3 + 1] = -(0.01 + Math.random() * 0.03); // Fall down
      vel[i3 + 2] = 0;
    }

    setParticles({ pos, vel });
    startTime.current = Date.now();
  }, [burstKey]);

  useFrame(() => {
    if (!particles || !pointsRef.current) return;

    const elapsed = Date.now() - startTime.current;
    if (elapsed > 2500) {
      setParticles(null);
      return;
    }

    const posAttr = pointsRef.current.geometry.attributes.position;
    for (let i = 0; i < particles.pos.length / 3; i++) {
      const i3 = i * 3;
      particles.pos[i3] += particles.vel[i3];
      particles.pos[i3 + 1] += particles.vel[i3 + 1];

      posAttr.setXYZ(i, particles.pos[i3], particles.pos[i3 + 1], particles.pos[i3 + 2]);
    }
    posAttr.needsUpdate = true;
    (pointsRef.current.material as THREE.PointsMaterial).opacity = 1.0 - elapsed / 2500;
  });

  useLayoutEffect(() => {
    if (particles) pointsRef.current?.layers.set(1);
  }, [particles]);

  if (!particles) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particles.pos.length / 3}
          array={particles.pos}
          itemSize={3}
          args={[particles.pos, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.015}
        color="#ffffff"
        transparent
        opacity={1}
        sizeAttenuation={false}
      />
    </points>
  );
}

/* ─── MAIN SHELL COMPONENT ───────────────────────────────────────────────── */

export interface AppShellLiquidWebGLProps {
  heroAccent: string;
  isScrolled: boolean;
  searchFocused: boolean;
  pointerRef: React.MutableRefObject<{ x: number; y: number } | null>;
  scanBurstKey: number;
  colors: LiquidBgColors;
  reducedEffects?: boolean;
}

export const AppShellLiquidWebGL = memo(function AppShellLiquidWebGL({
  heroAccent,
  isScrolled,
  searchFocused,
  pointerRef,
  scanBurstKey,
  colors,
  reducedEffects = false,
}: AppShellLiquidWebGLProps) {
  const documentHidden = useDocumentHidden();
  const pauseAnimation = reducedEffects || documentHidden;

  if (reducedEffects) return null;

  return (
    <div className="fixed inset-0 z-0 pointer-events-none select-none overflow-hidden bg-[#040408]">
      <Canvas
        className="h-full w-full"
        gl={liquidShellGl}
        camera={liquidShellOrthoCamera}
        orthographic
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.domElement.setAttribute('data-liquid-shell-canvas', '');
        }}
      >
        <LiquidShellRenderPipeline />

        <LiquidBackgroundPlane colors={colors} pauseAnimation={pauseAnimation} />

        <HeaderAuroraPlane
          accent={heroAccent}
          isScrolled={isScrolled}
          isFocused={searchFocused}
          pointerRef={pointerRef}
          pauseAnimation={pauseAnimation}
        />

        <ScanBurstParticles burstKey={scanBurstKey} />
      </Canvas>

      {/* Subtle depth veil to ensure UI readability over the metaballs */}
      <div
        className="absolute inset-0 z-10"
        style={{ background: 'oklch(0.08 0.005 140 / 0.55)' }}
      />
    </div>
  );
});

AppShellLiquidWebGL.displayName = 'AppShellLiquidWebGL';
