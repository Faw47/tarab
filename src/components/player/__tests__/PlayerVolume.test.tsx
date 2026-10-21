import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerVolume } from '../PlayerVolume';

const volumeMocks = vi.hoisted(() => ({
  applyVolume: vi.fn(),
  toggleMute: vi.fn(),
}));

vi.mock('../../../lib/volume', () => ({
  applyVolume: volumeMocks.applyVolume,
  isMuted: (volume: number) => volume <= 0.001,
  toggleMute: volumeMocks.toggleMute,
}));

vi.mock('../../../store/player-store', () => ({
  usePlayerStore: (selector: (state: { volume: number }) => unknown) => selector({ volume: 0.5 }),
}));

describe('PlayerVolume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes a named slider and sends keyboard changes to the shared volume action', () => {
    render(<PlayerVolume />);

    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toHaveAttribute('aria-valuenow', '0.5');

    slider.focus();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(volumeMocks.applyVolume).toHaveBeenCalledWith(0.51, 'player-volume');
  });

  it('keeps the mute control separate and labeled', () => {
    render(<PlayerVolume />);

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    expect(volumeMocks.toggleMute).toHaveBeenCalledWith('player-volume');
  });
});
