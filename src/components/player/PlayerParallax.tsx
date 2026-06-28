import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

interface ParallaxState {
  x: number;
  y: number;
}

const ParallaxContext = createContext<ParallaxState>({ x: 0, y: 0 });

interface ParallaxProviderProps {
  children: ReactNode;
}

export const ParallaxProvider = memo(({ children }: ParallaxProviderProps) => {
  const [parallax, setParallax] = useState<ParallaxState>({ x: 0, y: 0 });
  const parallaxFrame = useRef<number | null>(null);
  const lastUpdateTime = useRef<number>(0);
  const pendingUpdate = useRef<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    const { innerWidth, innerHeight } = window;
    const targetX = (event.clientX / innerWidth - 0.5) * 12;
    const targetY = (event.clientY / innerHeight - 0.5) * 8;

    // Store the latest target position
    pendingUpdate.current = { x: targetX, y: targetY };

    // Throttle to 60fps (16.67ms between updates)
    const now = performance.now();
    const timeSinceLastUpdate = now - lastUpdateTime.current;

    if (timeSinceLastUpdate >= 16) {
      // Update immediately if enough time has passed
      if (parallaxFrame.current) cancelAnimationFrame(parallaxFrame.current);
      lastUpdateTime.current = now;
      setParallax({ x: targetX, y: targetY });
      pendingUpdate.current = null;
    } else if (!parallaxFrame.current) {
      // Schedule update for next available frame
      parallaxFrame.current = requestAnimationFrame(() => {
        if (pendingUpdate.current) {
          lastUpdateTime.current = performance.now();
          setParallax(pendingUpdate.current);
          pendingUpdate.current = null;
        }
        parallaxFrame.current = null;
      });
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" onMouseMove={handleMouseMove}>
      <ParallaxContext.Provider value={parallax}>{children}</ParallaxContext.Provider>
    </div>
  );
});

ParallaxProvider.displayName = 'ParallaxProvider';

export const useParallax = () => useContext(ParallaxContext);
