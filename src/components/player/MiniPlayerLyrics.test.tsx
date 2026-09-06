import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import type { ParsedLyrics } from '../../types';
import { getCurrentLyricLine, MiniPlayerLyrics } from './MiniPlayerLyrics';

const smoothTime = vi.hoisted(() => ({
  callback: null as ((timeSec: number) => void) | null,
}));

vi.mock('../../contexts/smooth-time', () => ({
  useSmoothTimeSubscription: (callback: (timeSec: number) => void) => {
    smoothTime.callback = callback;
  },
  useSmoothTimeValue: () => ({ timeSec: 0 }),
}));

const lyrics: ParsedLyrics = {
  isEnhanced: false,
  lines: [
    { startTime: 1_000, endTime: 3_000, text: 'First line', words: [] },
    { startTime: 3_000, endTime: 5_000, text: 'Second line', words: [] },
  ],
};

describe('MiniPlayerLyrics', () => {
  beforeEach(() => {
    smoothTime.callback = null;
    usePlayerStore.setState({ lyrics: null, isPlaying: false });
  });

  it('selects the latest lyric line at or before the playback time', () => {
    expect(getCurrentLyricLine(null, 2)).toBeNull();
    expect(getCurrentLyricLine(lyrics, 0.9)).toBeNull();
    expect(getCurrentLyricLine(lyrics, 1)).toBe('First line');
    expect(getCurrentLyricLine(lyrics, 3)).toBe('Second line');
  });

  it('updates when the smooth-time subscription crosses a lyric boundary', () => {
    usePlayerStore.setState({ lyrics, isPlaying: true });
    render(<MiniPlayerLyrics />);

    expect(screen.queryByText('First line')).not.toBeInTheDocument();
    expect(smoothTime.callback).toBeTypeOf('function');

    act(() => smoothTime.callback?.(1.5));
    expect(screen.getByText('First line')).toBeInTheDocument();

    act(() => smoothTime.callback?.(3.2));
    expect(screen.getByText('Second line')).toBeInTheDocument();
    expect(screen.queryByText('First line')).not.toBeInTheDocument();
  });
});
