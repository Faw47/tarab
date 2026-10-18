import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { activeLyricIndex, MiniPlayerLyrics } from '../MiniPlayer';

const { subscribers } = vi.hoisted(() => ({ subscribers: new Set<(timeSec: number) => void>() }));

vi.mock('../../../contexts/smooth-time', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useSmoothTimeValue: () => ({ timeSec: 0 }),
    useSmoothTimeSubscription: (callback: (timeSec: number) => void) => {
      const ref = useRef(callback);
      ref.current = callback;
      useEffect(() => {
        const listener = (timeSec: number) => ref.current(timeSec);
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      }, []);
    },
  };
});

const lines = [
  { startTime: 0, text: 'first line' },
  { startTime: 5000, text: 'second line' },
];

describe('MiniPlayerLyrics', () => {
  it('finds the active line', () => {
    expect(activeLyricIndex(lines, 0)).toBe(0);
    expect(activeLyricIndex(lines, 7000)).toBe(1);
    expect(activeLyricIndex([{ startTime: 1000 }], 0)).toBe(-1);
  });

  it('advances the line as playback time moves', () => {
    // Regression for FE-23: the line was computed from a non-reactive time read during render.
    usePlayerStore.setState({
      lyrics: { lines, synced: true } as never,
      isPlaying: true,
    });
    render(<MiniPlayerLyrics />);
    expect(screen.getByText('first line')).toBeInTheDocument();

    act(() => {
      for (const notify of subscribers) notify(6);
    });
    expect(screen.getByText('second line')).toBeInTheDocument();
  });

  it('shows the right line when lyrics arrive while paused', () => {
    usePlayerStore.setState({ lyrics: null, isPlaying: false, currentTime: 6 });
    render(<MiniPlayerLyrics />);
    expect(screen.queryByText('second line')).toBeNull();

    act(() => {
      usePlayerStore.setState({ lyrics: { lines, synced: true } as never });
    });
    expect(screen.getByText('second line')).toBeInTheDocument();
  });
});
