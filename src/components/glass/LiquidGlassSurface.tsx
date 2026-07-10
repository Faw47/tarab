import type React from 'react';
import { useGlassSystem } from '../ui/liquid-glass';

export interface LiquidGlassSurfaceProps {
  /** Turn on fluid mouse interaction (ignored in CSS fallback) */
  interactive?: boolean;
  /** Optional background image/texture url to render behind the glass */
  bgTextureUrl?: string;
  /** CSS class to apply to the container wrapper */
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * LiquidGlassSurface
 * A CSS-based fallback for the Liquid Glass effect.
 * Uses backdrop-filter for performance and stability while the
 * WebGL compositor system is being migrated.
 */
export const LiquidGlassSurface: React.FC<LiquidGlassSurfaceProps> = ({
  bgTextureUrl,
  className,
  style,
  children,
}) => {
  const { theme, reducedEffects } = useGlassSystem();
  const isNeobrutalism = theme === 'neobrutalism';

  const glassStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundColor: isNeobrutalism ? 'transparent' : 'rgba(255, 255, 255, 0.03)',
    backdropFilter: reducedEffects || isNeobrutalism ? 'none' : 'blur(40px) saturate(210%)',
    WebkitBackdropFilter: reducedEffects || isNeobrutalism ? 'none' : 'blur(40px) saturate(210%)',
    backgroundImage: bgTextureUrl ? `url(${bgTextureUrl})` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    transition: 'backdrop-filter 0.3s ease, background-color 0.3s ease',
    pointerEvents: 'none',
    zIndex: 0,
  };

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        ...style,
      }}
    >
      <div style={glassStyle} aria-hidden="true" />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
        {children}
      </div>
    </div>
  );
};
