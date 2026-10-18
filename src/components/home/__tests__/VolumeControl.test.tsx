import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { VolumeControl } from '../HomeView.parts';

const { setEngineVolumeMock } = vi.hoisted(() => ({
  setEngineVolumeMock: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/tauri-commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tauri-commands')>()),
  setVolume: setEngineVolumeMock,
}));

describe('VolumeControl', () => {
  beforeEach(() => {
    setEngineVolumeMock.mockClear();
    usePlayerStore.setState({ volume: 0.8 });
  });

  it('mutes the audio engine, not only the icon', () => {
    // Regression for FE-05: Mute changed the store volume but never reached the engine.
    render(<VolumeControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    expect(setEngineVolumeMock).toHaveBeenCalledWith(0);
    expect(usePlayerStore.getState().volume).toBe(0);
  });
});
