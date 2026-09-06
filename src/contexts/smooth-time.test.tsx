import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSmoothTime } from '../hooks/useSmoothTime';
import { usePlayerStore } from '../store/player-store';
import { useSmoothTimeState } from './smooth-time';

afterEach(() => {
  vi.restoreAllMocks();
  usePlayerStore.setState({ currentTime: 0, isPlaying: false, playbackSpeed: 1 });
});

describe('smooth playback time', () => {
  it('tracks coarse time for isolated components without a provider', () => {
    const { result } = renderHook(() => useSmoothTimeState(0));

    expect(result.current).toBe(0);

    act(() => {
      usePlayerStore.getState().setCurrentTime(41);
    });

    expect(result.current).toBe(41);
  });

  it('projects elapsed playback time and freezes it while paused', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    const { result } = renderHook(() => useSmoothTime());

    act(() => {
      usePlayerStore.setState({ currentTime: 10, isPlaying: true, playbackSpeed: 1 });
    });
    now.mockReturnValue(2500);
    expect(result.current()).toBeCloseTo(11500, 4);

    now.mockReturnValue(3000);
    act(() => {
      usePlayerStore.setState({ isPlaying: false });
    });
    now.mockReturnValue(5000);
    expect(result.current()).toBeCloseTo(12000, 4);

    act(() => {
      usePlayerStore.setState({ isPlaying: true, playbackSpeed: 2 });
    });
    now.mockReturnValue(5500);
    expect(result.current()).toBeCloseTo(13000, 4);
  });
});
