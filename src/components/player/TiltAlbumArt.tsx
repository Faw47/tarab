import { ContactShadows, Environment, Float, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { useMotionValue, useSpring, useTransform } from 'framer-motion';
import { VinylIcon } from '../ui/Icons';
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { getCoverArtDataUrlFallback, markCoverArtProtocolFailed } from '../../hooks/useCoverArt';

interface TiltAlbumArtProps {
  src: string;
  className?: string;
}

class TextureErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    src: string;
    onError: () => void;
  },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any) {
    console.error('TiltAlbumArt load error:', error);
    this.props.onError();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-zinc-800 flex items-center justify-center rounded-2xl">
          <VinylIcon className="w-12 h-12 text-zinc-600" />
        </div>
      );
    }
    return this.props.children;
  }
}

const AlbumMesh = ({ src }: { src: string }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const texture = useLoader(THREE.TextureLoader, src);

  // Mouse position normalized (-1 to 1)
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smooth springs for rotation
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [0.3, -0.3]), {
    stiffness: 150,
    damping: 20,
  });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-0.3, 0.3]), {
    stiffness: 150,
    damping: 20,
  });

  useFrame((state) => {
    const { x, y } = state.pointer;
    mouseX.set(x);
    mouseY.set(y);

    if (groupRef.current) {
      groupRef.current.rotation.x = rotateX.get();
      groupRef.current.rotation.y = rotateY.get();
    }
  });

  return (
    <group ref={groupRef}>
      <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
        <mesh ref={meshRef} castShadow receiveShadow>
          <boxGeometry args={[3.2, 3.2, 0.1]} />
          {/* Multi-material for the thick premium look */}
          <meshStandardMaterial attach="material-0" color="#222" />
          <meshStandardMaterial attach="material-1" color="#222" />
          <meshStandardMaterial attach="material-2" color="#222" />
          <meshStandardMaterial attach="material-3" color="#222" />
          <meshStandardMaterial attach="material-4" map={texture} roughness={0.3} metalness={0.2} />
          <meshStandardMaterial attach="material-5" color="#111" />
        </mesh>
      </Float>
    </group>
  );
};

export const TiltAlbumArt = ({ src, className }: TiltAlbumArtProps) => {
  const [hasError, setHasError] = useState(false);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const activeSrc = fallbackSrc ?? src;

  useEffect(() => {
    setHasError(false);
    setFallbackSrc(null);
  }, [src]);

  const handleError = async () => {
    if (src?.startsWith('cover-art://')) {
      const parts = src.split('/');
      const hash = parts[3];
      const size = parts[4] || 'large';
      if (hash) {
        markCoverArtProtocolFailed(hash, size as 'small' | 'medium' | 'large');
        const dataUrl = await getCoverArtDataUrlFallback(hash, size as 'small' | 'medium' | 'large');
        if (dataUrl) {
          setFallbackSrc(dataUrl);
          setHasError(false);
          return;
        }
      }
    }
    setHasError(true);
  };

  if (hasError) {
    return (
      <div className={className}>
        <div className="w-full h-full bg-zinc-800 flex items-center justify-center rounded-2xl shadow-2xl shadow-black/50">
          <VinylIcon className="w-24 h-24 text-zinc-600" />
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <TextureErrorBoundary key={activeSrc} src={activeSrc} onError={() => void handleError()}>
        <Canvas shadows dpr={[1, 2]}>
          <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={50} />
          <ambientLight intensity={1.5} />
          <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
          <pointLight position={[-10, -10, -10]} intensity={0.5} />

          <React.Suspense fallback={null}>
            <AlbumMesh src={activeSrc} />
            <Environment preset="city" />
            <ContactShadows position={[0, -2, 0]} opacity={0.4} scale={10} blur={2.5} far={4} />
          </React.Suspense>
        </Canvas>
      </TextureErrorBoundary>
    </div>
  );
};

TiltAlbumArt.displayName = 'TiltAlbumArt';
