import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { AlbumDetailsOverlay, type AlbumDetailsOverlayProps } from '../AlbumDetailsOverlay';
import { AlbumDetailsOverlayNeo } from '../AlbumDetailsOverlayNeo';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));

const makeTrack = (n: number): Track => ({
  id: `t${n}`,
  filePath: `/music/${n}.flac`,
  title: `Song ${n}`,
  artist: 'Artist',
  album: 'Album',
  year: 2020,
  duration: 100,
  hasCoverArt: false,
  dateAdded: 0,
});
const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];

function renderOverlay(
  Overlay: ComponentType<AlbumDetailsOverlayProps>,
  props: Partial<AlbumDetailsOverlayProps> = {},
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Overlay album="Album" artist="Artist" tracks={tracks} onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe.each([
  ['liquid', AlbumDetailsOverlay as ComponentType<AlbumDetailsOverlayProps>],
  ['neo', AlbumDetailsOverlayNeo as ComponentType<AlbumDetailsOverlayProps>],
])('%s album tracklist (FE-27)', (_name, Overlay) => {
  it('is a grid, so aria-selected on its rows is valid', () => {
    renderOverlay(Overlay, { selectedTrackIds: ['t2'] });
    const grid = screen.getByRole('grid', { name: 'Album tracklist' });
    expect(screen.queryByRole('table')).toBeNull();
    const rows = within(grid).getAllByRole('row');
    // Header row plus one row per track.
    expect(rows).toHaveLength(4);
    expect(within(grid).queryAllByRole('cell')).toHaveLength(0);
    expect(rows[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps one row in the tab order and marks selection only while selecting', () => {
    renderOverlay(Overlay);
    const grid = screen.getByRole('grid');
    const rows = within(grid).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    for (const row of rows) expect(row).not.toHaveAttribute('aria-selected');
    // Only rows and their header are owned by the grid.
    for (const child of Array.from(grid.children)) {
      expect(child.getAttribute('role')).toBe('rowgroup');
    }

    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(rows[1]).toHaveFocus();
    expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves focus between rows with arrow, Home and End keys', () => {
    renderOverlay(Overlay);
    const rows = within(screen.getByRole('grid')).getAllByRole('row').slice(1);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1], { key: 'End' });
    expect(rows[2]).toHaveFocus();
    fireEvent.keyDown(rows[2], { key: 'ArrowUp' });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1], { key: 'Home' });
    expect(rows[0]).toHaveFocus();
  });

  it('Enter on a row plays it, but Enter on a control inside the row does not', () => {
    const onPlayTrack = vi.fn();
    renderOverlay(Overlay, { onPlayTrack, selectedTrackIds: ['t1'] });
    const rows = within(screen.getByRole('grid')).getAllByRole('row').slice(1);
    const select = within(rows[0]).getByRole('button', { name: 'Deselect Song 1' });
    fireEvent.keyDown(select, { key: 'Enter' });
    expect(onPlayTrack).not.toHaveBeenCalled();
    fireEvent.keyDown(rows[1], { key: 'Enter' });
    expect(onPlayTrack).toHaveBeenCalledWith(tracks[1]);
  });
});

describe('liquid album track row controls (FE-27)', () => {
  it('labels the More button and reveals row controls on focus', () => {
    renderOverlay(AlbumDetailsOverlay);
    const more = screen.getByRole('button', { name: 'More actions for Song 1' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    expect(more.className).toContain('group-focus-within:opacity-100');
    const play = screen.getByRole('button', { name: 'Play Song 1' });
    expect(play.parentElement?.className).toContain('group-focus-within:opacity-100');
  });

  it('does not announce every playing waveform as a live status region', () => {
    renderOverlay(AlbumDetailsOverlay, { currentlyPlayingId: 't1', isPlaying: true });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('row', { name: 'Song 1 by Artist, now playing' })).toBeInTheDocument();
  });
});

describe('neo album metadata direction (FE-22)', () => {
  it('isolates sticky and hero album headings and the artist', () => {
    renderOverlay(AlbumDetailsOverlayNeo as ComponentType<AlbumDetailsOverlayProps>, {
      album: 'ألبوم 2026 (Live)',
      artist: 'فيروز',
    });
    for (const heading of screen.getAllByRole('heading', { name: 'ألبوم 2026 (Live)' })) {
      expect(heading).toHaveAttribute('dir', 'auto');
    }
    expect(screen.getByText('فيروز')).toHaveAttribute('dir', 'auto');
  });
});
