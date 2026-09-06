import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../button';

const { useGlassSystemMock, usePointerTracker } = vi.hoisted(() => ({
  useGlassSystemMock: vi.fn(() => ({ theme: 'liquid-glass', reducedEffects: false })),
  usePointerTracker: vi.fn(() => ({
    ref: { current: null },
    measure: vi.fn(),
    scheduleUpdate: vi.fn(),
    clearVars: vi.fn(),
    invalidateRect: vi.fn(),
  })),
}));

vi.mock('../liquid-glass', () => ({
  useGlassSystem: useGlassSystemMock,
  usePointerTracker,
  usePrefersReducedMotion: () => false,
}));

describe('Button', () => {
  beforeEach(() => {
    useGlassSystemMock.mockReturnValue({ theme: 'liquid-glass', reducedEffects: false });
  });

  it('only mounts liquid pointer tracking for liquid-effect variants', () => {
    const { rerender } = render(<Button variant="ghost">Ghost</Button>);

    expect(screen.getByRole('button', { name: 'Ghost' })).toBeInTheDocument();
    expect(usePointerTracker).not.toHaveBeenCalled();

    rerender(<Button variant="default">Default</Button>);

    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument();
    expect(usePointerTracker).toHaveBeenCalledTimes(1);
  });

  it('exposes the variant contract used by the Neobrutalism button styles', () => {
    useGlassSystemMock.mockReturnValue({ theme: 'neobrutalism', reducedEffects: false });

    render(<Button variant="danger">Delete</Button>);

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveAttribute('data-button-variant', 'danger');
    expect(button).toHaveClass('neo-button');
  });

  it('keeps rapid ripples distinct and clears their timers on unmount', () => {
    vi.useFakeTimers();
    try {
      const view = render(<Button>Ripple</Button>);
      const button = screen.getByRole('button', { name: 'Ripple' });

      const firePointerDown = (clientX: number, clientY: number) => {
        const event = createEvent.pointerDown(button, { pointerType: 'mouse' });
        Object.defineProperty(event, 'clientX', { value: clientX });
        Object.defineProperty(event, 'clientY', { value: clientY });
        fireEvent(button, event);
      };
      firePointerDown(10, 10);
      firePointerDown(12, 12);

      const ripples = Array.from(view.container.querySelectorAll('span')).filter((element) =>
        element.style.animation.includes('adl-liquid-ripple'),
      );
      expect(ripples).toHaveLength(2);

      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      act(() => vi.runOnlyPendingTimers());
      vi.useRealTimers();
    }
  });
});
