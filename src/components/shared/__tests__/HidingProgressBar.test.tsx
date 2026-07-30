import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seekToPosition } from '../../../lib/playback-actions';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import { HidingProgressBar } from '../HidingProgressBar';

vi.mock('../../../lib/playback-actions', () => ({
  seekToPosition: vi.fn(async () => undefined),
}));

vi.mock('../../ui/liquid-glass', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/liquid-glass')>();
  return {
    ...actual,
    usePrefersReducedMotion: () => false,
  };
});

describe('HidingProgressBar', () => {
  beforeEach(() => {
    if (typeof PointerEvent === 'undefined') {
      Object.defineProperty(globalThis, 'PointerEvent', {
        configurable: true,
        value: MouseEvent,
      });
    }
    vi.mocked(seekToPosition).mockClear();
    usePlayerStore.setState({ currentTime: 60, duration: 240 });
    useSettingsStore.setState({ reducedEffects: false });
  });

  it('reports the current time and supports every keyboard seek command', () => {
    render(
      <div className="group">
        <HidingProgressBar />
      </div>,
    );

    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(slider).toHaveAttribute('aria-valuenow', '60');
    expect(slider).toHaveAttribute('aria-valuemax', '240');
    expect(slider).toHaveAttribute('aria-valuetext', '1:00 of 4:00');

    for (const [key, expected] of [
      ['ArrowRight', 62.4],
      ['ArrowLeft', 57.6],
      ['ArrowUp', 62.4],
      ['ArrowDown', 57.6],
      ['PageUp', 72],
      ['PageDown', 48],
      ['Home', 0],
      ['End', 240],
    ] as const) {
      fireEvent.keyDown(slider, { key });
      expect(seekToPosition).toHaveBeenLastCalledWith(expected);
    }
  });

  it('previews pointer movement locally and sends one seek when the drag ends', () => {
    render(
      <div className="group">
        <HidingProgressBar />
      </div>,
    );

    const slider = screen.getByRole('slider', { name: 'Seek' });
    Object.defineProperties(slider, {
      getBoundingClientRect: {
        value: () => ({
          left: 100,
          right: 500,
          top: 0,
          bottom: 20,
          width: 400,
          height: 20,
          x: 100,
          y: 0,
          toJSON: () => undefined,
        }),
      },
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });

    fireEvent.pointerDown(slider, { pointerId: 7, clientX: 200 });
    fireEvent.pointerMove(slider, { pointerId: 7, clientX: 300 });

    expect(slider).toHaveAttribute('aria-valuenow', '120');
    expect(seekToPosition).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider, { pointerId: 7, clientX: 400 });

    expect(seekToPosition).toHaveBeenCalledTimes(1);
    expect(seekToPosition).toHaveBeenCalledWith(180);
  });
});
