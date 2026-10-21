import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../button';

const { usePointerTracker } = vi.hoisted(() => ({
  usePointerTracker: vi.fn(() => ({
    ref: { current: null },
    measure: vi.fn(),
    scheduleUpdate: vi.fn(),
    clearVars: vi.fn(),
    invalidateRect: vi.fn(),
  })),
}));

vi.mock('../liquid-glass', () => ({
  useGlassSystem: () => ({ theme: 'liquid-glass', reducedEffects: false }),
  usePointerTracker,
  usePrefersReducedMotion: () => false,
}));

describe('Button', () => {
  it('only mounts liquid pointer tracking for liquid-effect variants', () => {
    const { rerender } = render(<Button variant="ghost">Ghost</Button>);

    expect(screen.getByRole('button', { name: 'Ghost' })).toBeInTheDocument();
    expect(usePointerTracker).not.toHaveBeenCalled();

    rerender(<Button variant="default">Default</Button>);

    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument();
    expect(usePointerTracker).toHaveBeenCalledTimes(1);
  });
  it('removes per-button blur when reduced effects are enabled', () => {
    render(<Button>Normal</Button>);
    const normalButton = screen.getByRole('button', { name: 'Normal' });
    expect(normalButton).toHaveClass('backdrop-blur-[10px]');
    expect(normalButton).toHaveClass('backdrop-saturate-[1.35]');

    render(<Button reducedEffects>Reduced</Button>);
    const reducedButton = screen.getByRole('button', { name: 'Reduced' });
    expect(reducedButton).not.toHaveClass('backdrop-blur-[10px]');
    expect(reducedButton).not.toHaveClass('backdrop-saturate-[1.35]');
  });
});
