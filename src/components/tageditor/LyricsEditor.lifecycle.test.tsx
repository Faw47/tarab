import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LyricsEditor } from './LyricsEditor';

const playerState = {
  currentTrack: null,
  isPlaying: false,
  duration: 0,
  setCurrentTime: vi.fn(),
  hasActivePlayback: false,
};

vi.mock('../../contexts/smooth-time', () => ({
  useSmoothTimeState: () => 0,
}));

vi.mock('../../store/player-store', () => ({
  usePlayerStore: (selector: (state: typeof playerState) => unknown) => selector(playerState),
}));

vi.mock('../../lib/playback-actions', () => ({
  captureActivePlaybackSource: vi.fn(() => null),
  pauseCurrentPlayback: vi.fn(async () => undefined),
  resumeCurrentPlayback: vi.fn(async () => undefined),
  seekToPosition: vi.fn(async () => undefined),
  startEditorPreview: vi.fn(async () => undefined),
}));

const track = {
  id: 'track-1',
  title: 'Test track',
  artist: 'Test artist',
  album: 'Test album',
  year: null,
  duration: 120,
  filePath: 'C:/music/test.mp3',
  hasCoverArt: false,
  dateAdded: 1,
};

describe('LyricsEditor transient errors', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a repeated error visible for the full duration of the latest message', () => {
    const view = render(
      <LyricsEditor
        track={track}
        lyricsContent="[00:01.00] Hello"
        onChange={vi.fn()}
        onSave={vi.fn()}
        isSaving={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Text Editor' }));
    const editor = screen.getByRole('textbox', { name: 'LRC lyric content' });

    fireEvent.change(editor, { target: { value: 'invalid first value' } });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid LRC format');

    act(() => vi.advanceTimersByTime(2_500));
    fireEvent.change(editor, { target: { value: 'invalid second value' } });
    act(() => vi.advanceTimersByTime(500));

    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid LRC format');

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
