import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { AlbumSpotlightCard } from '../HomeView.parts';

const track: Track = {
  id: 't1',
  filePath: '/music/a.flac',
  title: 'Song',
  artist: 'Fairuz',
  album: 'Maarifti Feek',
  year: 1960,
  duration: 200,
  hasCoverArt: false,
  dateAdded: 0,
};

describe('AlbumSpotlightCard', () => {
  it('keeps Open and Play as separate, keyboard-usable buttons', () => {
    // Regression for FE-15 and FE-21: Play sat inside a role="button" card, and Enter on it
    // bubbled up and opened the album instead.
    const onOpen = vi.fn();
    const onPlay = vi.fn(async () => undefined);
    const { container } = render(
      <AlbumSpotlightCard
        track={track}
        count={1}
        albumTracks={[track]}
        featured={false}
        interactiveSpotlight={false}
        reducedEffects
        onOpenAlbumDetails={onOpen}
        onPlayAlbum={onPlay}
      />,
    );

    expect(container.querySelector('button button, [role="button"] button')).toBeNull();
    const play = screen.getByRole('button', { name: 'Play Maarifti Feek' });
    fireEvent.keyDown(play, { key: 'Enter' });
    fireEvent.click(play);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open Maarifti Feek by Fairuz' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the album title without hover and enters without a stagger delay', () => {
    // Regression for FE-30: regular cards hid their title until hover, and cards staggered in.
    const { container } = render(
      <AlbumSpotlightCard
        track={track}
        count={1}
        albumTracks={[track]}
        featured={false}
        interactiveSpotlight={false}
        reducedEffects={false}
        onPlayAlbum={vi.fn(async () => undefined)}
      />,
    );
    const title = screen.getByText('Maarifti Feek');
    let node: HTMLElement | null = title;
    while (node && node !== container) {
      expect(node.className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
      node = node.parentElement;
    }
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('[style]'))) {
      expect(el.style.animationDelay).toBe('');
    }
  });
});
