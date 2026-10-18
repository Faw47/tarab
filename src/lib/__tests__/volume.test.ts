import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import { applyVolume, resetVolumeMemoryForTests, stepVolume, toggleMute } from '../volume';

const { setAudioVolumeMock, reportErrorMock } = vi.hoisted(() => ({
  setAudioVolumeMock: vi.fn(async () => undefined),
  reportErrorMock: vi.fn(),
}));
vi.mock('../tauri-commands', () => ({ setVolume: setAudioVolumeMock }));
vi.mock('../report-error', () => ({ reportError: reportErrorMock, logError: vi.fn() }));

describe('volume (FE-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVolumeMemoryForTests();
    usePlayerStore.setState({ volume: 0.4 });
  });

  it('unmutes to the level that was muted, whichever control did it', async () => {
    await toggleMute('home');
    expect(usePlayerStore.getState().volume).toBe(0);
    expect(setAudioVolumeMock).toHaveBeenLastCalledWith(0);
    await toggleMute('keyboard');
    expect(usePlayerStore.getState().volume).toBe(0.4);
    expect(setAudioVolumeMock).toHaveBeenLastCalledWith(0.4);
  });

  it('remembers the last audible level set by a slider', async () => {
    await applyVolume(0.65);
    await applyVolume(0);
    await toggleMute();
    expect(usePlayerStore.getState().volume).toBe(0.65);
  });

  it('starts from 80% when nothing audible was set yet', async () => {
    usePlayerStore.setState({ volume: 0 });
    await toggleMute();
    expect(usePlayerStore.getState().volume).toBe(0.8);
  });

  it('clamps and steps to whole percents', async () => {
    usePlayerStore.setState({ volume: 0.95 });
    await stepVolume(0.1);
    expect(usePlayerStore.getState().volume).toBe(1);
    usePlayerStore.setState({ volume: 0.3 });
    await stepVolume(-0.1);
    expect(usePlayerStore.getState().volume).toBe(0.2);
  });

  it('reports an engine failure once', async () => {
    setAudioVolumeMock.mockRejectedValueOnce(new Error('no device'));
    await applyVolume(0.5, 'player-volume');
    expect(reportErrorMock).toHaveBeenCalledWith('Could not set the volume', {
      source: 'player-volume',
      error: expect.any(Error),
    });
  });

  it('does not unmute to the near-silent levels a drag to zero passes through', async () => {
    await applyVolume(0.6);
    for (const level of [0.3, 0.09, 0.04, 0.01, 0]) await applyVolume(level);
    await toggleMute();
    expect(usePlayerStore.getState().volume).toBe(0.3);
  });
});
