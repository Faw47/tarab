import { Canvas } from '@react-three/fiber';
import { LiquidBackgroundPlane, type LiquidBgColors } from '../shell/liquid-background-mesh';

export function LiquidBackgroundCanvas({
  colors,
  pauseAnimation,
}: {
  colors: LiquidBgColors;
  pauseAnimation: boolean;
}) {
  return (
    <Canvas className="absolute inset-0 z-0" camera={{ position: [0, 0, 1] }} orthographic>
      <LiquidBackgroundPlane colors={colors} pauseAnimation={pauseAnimation} />
    </Canvas>
  );
}
