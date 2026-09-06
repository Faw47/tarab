import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type { ParsedLyrics } from '../../types';

vi.mock('./LyricsLine', () => ({
  LyricsLine: ({ line, isCurrent }: { line: { text: string }; isCurrent: boolean }) => (
    <div data-testid={isCurrent ? 'active-lyric' : 'lyric-line'}>{line.text}</div>
  ),
}));

import { LyricsDisplay } from './LyricsDisplay';

const makeLyrics = (secondLineText: string): ParsedLyrics => ({
  isEnhanced: false,
  lines: [
    { startTime: 0, endTime: 10_000, text: 'First line', words: [] },
    { startTime: 10_000, endTime: 20_000, text: secondLineText, words: [] },
  ],
});

beforeEach(() => {
  useSettingsStore.setState({ lyricsEnabled: true });
  usePlayerStore.setState({
    currentTrack: null,
    currentTime: 0,
    isPlaying: false,
    lyrics: makeLyrics('Second line'),
  });
});

afterEach(() => {
  usePlayerStore.setState({ currentTrack: null, currentTime: 0, isPlaying: false, lyrics: null });
});

describe('LyricsDisplay clock reconciliation', () => {
  it('updates the active line for paused seeks and lyric source changes', () => {
    render(<LyricsDisplay />);

    expect(screen.getByTestId('active-lyric')).toHaveTextContent('First line');

    act(() => {
      usePlayerStore.getState().setCurrentTime(11);
    });
    expect(screen.getByTestId('active-lyric')).toHaveTextContent('Second line');

    act(() => {
      usePlayerStore.getState().setLyrics(makeLyrics('Updated second line'));
    });
    expect(screen.getByTestId('active-lyric')).toHaveTextContent('Updated second line');
  });
});
it('updates the active line from the shared smooth-time subscription while playing', () => {
  usePlayerStore.setState({ currentTime: 1, isPlaying: true });
  render(<LyricsDisplay />);

  expect(screen.getByTestId('active-lyric')).toHaveTextContent('First line');

  act(() => {
    usePlayerStore.getState().setCurrentTime(11);
  });

  expect(screen.getByTestId('active-lyric')).toHaveTextContent('Second line');
});
