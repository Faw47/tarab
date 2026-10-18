import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VolumeControl } from '../HomeView.parts';

vi.mock('../../../lib/tauri-commands', () => ({ setVolume: vi.fn(async () => undefined) }));

describe('Home VolumeControl (FE-16)', () => {
  it('opens the slider for keyboard focus, not only for hover', () => {
    render(<VolumeControl />);
    const slider = screen.getByLabelText('Volume');
    const wrapper = slider.parentElement as HTMLElement;
    expect(wrapper.className).toContain('w-0');
    fireEvent.focus(screen.getByRole('button', { name: /mute/i }));
    expect(wrapper.className).toContain('w-[96px]');
  });
});
