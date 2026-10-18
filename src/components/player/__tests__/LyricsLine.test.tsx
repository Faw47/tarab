import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LyricLine } from '../../../types';
import { LyricsLine } from '../LyricsLine';

vi.mock('../../../hooks/useEffectiveReducedEffects', () => ({
  useEffectiveReducedEffects: () => false,
}));

const glow = {
  highlight: '#fff',
  glow1: '#fff',
  glow2: '#fff',
  glow3: '#fff',
  shadow: '#000',
  textGlow1: '#fff',
  textGlow2: '#fff',
};

function renderLine(text: string) {
  const line = {
    text,
    startTime: 0,
    endTime: 1000,
    runs: [{ word: { text, startTime: 0, endTime: 1000 }, prefix: '' }],
  } as unknown as LyricLine;
  render(
    <LyricsLine
      line={line}
      isCurrent
      isNeighbor={false}
      isFar={false}
      glowColors={glow}
      onLineClick={vi.fn()}
      onWordClick={vi.fn()}
      useKaraoke
      lyricSize={50}
      lyricAlignment="center"
    />,
  );
  return screen.getByRole('button', { name: `Seek to ${text}` });
}

describe('LyricsLine direction (FE-22)', () => {
  it('lays out and fills an Arabic line right to left', () => {
    const row = renderLine('تملي معاك');
    expect(row).toHaveAttribute('dir', 'rtl');
    const word = row.querySelector<HTMLElement>('[data-karaoke-word]');
    expect(word).toHaveAttribute('data-fill-from', 'right');
  });

  it('keeps Latin lines left to right', () => {
    const row = renderLine('Hello there');
    expect(row).toHaveAttribute('dir', 'ltr');
    const word = row.querySelector<HTMLElement>('[data-karaoke-word]');
    expect(word).toHaveAttribute('data-fill-from', 'left');
  });
});
