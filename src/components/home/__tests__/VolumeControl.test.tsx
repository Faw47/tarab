import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VolumeControl } from '../HomeView.parts';

vi.mock('../../../lib/tauri-commands', () => ({ setVolume: vi.fn(async () => undefined) }));

describe('Home VolumeControl (FE-16)', () => {
  it('keeps the focused slider visible after the pointer leaves, then closes after blur', () => {
    vi.useFakeTimers();
    try {
      render(<VolumeControl />);
      const slider = screen.getByRole('slider', { name: 'Volume' });
      const sliderWrapper = slider.parentElement as HTMLElement;
      const hoverWrapper = screen.getByRole('button', { name: /mute/i })
        .parentElement as HTMLElement;
      act(() => slider.focus());
      fireEvent.mouseLeave(hoverWrapper);
      act(() => vi.advanceTimersByTime(350));
      expect(slider).toHaveFocus();
      expect(sliderWrapper).toHaveClass('w-[96px]', 'opacity-100');
      fireEvent.blur(slider, { relatedTarget: document.body });
      act(() => vi.advanceTimersByTime(350));
      expect(sliderWrapper).toHaveClass('w-0', 'opacity-0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the slider for keyboard focus, not only for hover', () => {
    render(<VolumeControl />);
    const slider = screen.getByLabelText('Volume');
    const wrapper = slider.parentElement as HTMLElement;
    expect(wrapper.className).toContain('w-0');
    fireEvent.focus(screen.getByRole('button', { name: /mute/i }));
    expect(wrapper.className).toContain('w-[96px]');
  });
});
