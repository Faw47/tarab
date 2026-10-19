import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type ComponentType, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const client = new QueryClient();
  const wrap = (nextProps: Partial<AlbumDetailsOverlayProps>) => (
    <QueryClientProvider client={client}>
      <Overlay album="Album" artist="Artist" tracks={tracks} onClose={vi.fn()} {...nextProps} />
    </QueryClientProvider>
  );
  const result = render(wrap(props));
  return {
    ...result,
    rerenderOverlay: (nextProps: Partial<AlbumDetailsOverlayProps>) =>
      result.rerender(wrap(nextProps)),
  };
}

describe.each([
  ['liquid', AlbumDetailsOverlay as ComponentType<AlbumDetailsOverlayProps>],
  ['neo', AlbumDetailsOverlayNeo as ComponentType<AlbumDetailsOverlayProps>],
])('%s album tracklist (FE-27)', (_name, Overlay) => {
  it('opens optional details on a plain click and gives them a playback action', () => {
    const onOpenTrackDetails = vi.fn();
    const onPlayTrack = vi.fn();
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onOpenTrackDetails, onPlayTrack, onTrackSelect });
    fireEvent.click(within(screen.getByRole('grid')).getAllByRole('row')[1]);
    expect(onOpenTrackDetails).toHaveBeenCalledExactlyOnceWith(tracks[0], expect.any(Function));
    expect(onTrackSelect).not.toHaveBeenCalled();
    onOpenTrackDetails.mock.calls[0][1]();
    expect(onPlayTrack).toHaveBeenCalledExactlyOnceWith(tracks[0]);
  });

  it('selects on plain click during selection mode instead of opening details', () => {
    const onOpenTrackDetails = vi.fn();
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onOpenTrackDetails, onTrackSelect, selectedTrackIds: ['t1'] });
    fireEvent.click(within(screen.getByRole('grid')).getAllByRole('row')[2]);
    expect(onTrackSelect).toHaveBeenCalledExactlyOnceWith(tracks[1], true);
    expect(onOpenTrackDetails).not.toHaveBeenCalled();
  });

  it.each(['ctrlKey', 'metaKey', 'shiftKey'])('uses %s for selection instead of details', (key) => {
    const onOpenTrackDetails = vi.fn();
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onOpenTrackDetails, onTrackSelect });
    fireEvent.click(within(screen.getByRole('grid')).getAllByRole('row')[2], { [key]: true });
    expect(onTrackSelect).toHaveBeenCalledExactlyOnceWith(tracks[1], true);
    expect(onOpenTrackDetails).not.toHaveBeenCalled();
  });

  it.each([
    'Enter',
    'doubleClick',
  ])('routes current-track %s through the parent playback action', (input) => {
    const onPlayTrack = vi.fn();
    renderOverlay(Overlay, { currentlyPlayingId: 't1', isPlaying: true, onPlayTrack });
    const row = within(screen.getByRole('grid')).getAllByRole('row')[1];
    if (input === 'Enter') fireEvent.keyDown(row, { key: 'Enter' });
    else fireEvent.doubleClick(row);
    expect(onPlayTrack).toHaveBeenCalledExactlyOnceWith(tracks[0]);
  });

  it('Space selects in selection mode without playing', () => {
    const onPlayTrack = vi.fn();
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onPlayTrack, onTrackSelect, selectedTrackIds: ['t1'] });
    fireEvent.keyDown(within(screen.getByRole('grid')).getAllByRole('row')[2], { key: ' ' });
    expect(onTrackSelect).toHaveBeenCalledExactlyOnceWith(tracks[1], true);
    expect(onPlayTrack).not.toHaveBeenCalled();
  });

  it('Space requests playback when selection mode is off', () => {
    const onPlayTrack = vi.fn();
    renderOverlay(Overlay, { onPlayTrack });
    fireEvent.keyDown(within(screen.getByRole('grid')).getAllByRole('row')[2], { key: ' ' });
    expect(onPlayTrack).toHaveBeenCalledExactlyOnceWith(tracks[1]);
  });

  it('does not play when double-clicking a nested selection control', () => {
    const onPlayTrack = vi.fn();
    renderOverlay(Overlay, { onPlayTrack, selectedTrackIds: ['t1'] });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Deselect Song 1' }));
    expect(onPlayTrack).not.toHaveBeenCalled();
  });

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

describe.each([
  ['liquid', AlbumDetailsOverlay as ComponentType<AlbumDetailsOverlayProps>],
  ['neo', AlbumDetailsOverlayNeo as ComponentType<AlbumDetailsOverlayProps>],
])('%s album hold selection (FE-18)', (_name, Overlay) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const firstRow = () => within(screen.getByRole('grid')).getAllByRole('row')[1];

  it('consumes the release click after a completed hold without opening details', () => {
    const onTrackSelect = vi.fn();
    const onOpenTrackDetails = vi.fn();
    renderOverlay(Overlay, { onTrackSelect, onOpenTrackDetails });
    fireEvent.mouseDown(firstRow(), { button: 0 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.mouseUp(firstRow());
    fireEvent.click(firstRow());
    expect(onTrackSelect).toHaveBeenCalledExactlyOnceWith(tracks[0], false);
    expect(onOpenTrackDetails).not.toHaveBeenCalled();
  });

  it('consumes compatibility mouse events after a completed touch hold', () => {
    const onTrackSelect = vi.fn();
    const onOpenTrackDetails = vi.fn();
    renderOverlay(Overlay, { onTrackSelect, onOpenTrackDetails });
    fireEvent.pointerDown(firstRow(), { pointerType: 'touch' });
    fireEvent.touchStart(firstRow());
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(firstRow());
    fireEvent.mouseDown(firstRow(), { button: 0 });
    fireEvent.mouseUp(firstRow());
    fireEvent.click(firstRow());
    expect(onTrackSelect).toHaveBeenCalledExactlyOnceWith(tracks[0], false);
    expect(onOpenTrackDetails).not.toHaveBeenCalled();
  });

  it('keeps parent-owned selection after touch compatibility events', () => {
    const ControlledOverlay = (props: AlbumDetailsOverlayProps) => {
      const [selected, setSelected] = useState<string[]>([]);
      return (
        <Overlay
          {...props}
          selectedTrackIds={selected}
          onTrackSelect={(track, multi) => {
            setSelected((ids) =>
              multi && ids.includes(track.id)
                ? ids.filter((id) => id !== track.id)
                : [...(multi ? ids : []), track.id],
            );
          }}
        />
      );
    };
    renderOverlay(ControlledOverlay);
    fireEvent.pointerDown(firstRow(), { pointerType: 'touch' });
    fireEvent.touchStart(firstRow());
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(firstRow());
    fireEvent.mouseDown(firstRow(), { button: 0 });
    fireEvent.mouseUp(firstRow());
    fireEvent.click(firstRow());
    expect(firstRow()).toHaveAttribute('aria-selected', 'true');
  });

  it('allows a fresh mouse gesture after a touch hold without a compatibility click', () => {
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onTrackSelect });
    fireEvent.touchStart(firstRow());
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(firstRow());
    fireEvent.pointerDown(firstRow(), { pointerType: 'mouse' });
    fireEvent.mouseDown(firstRow(), { button: 0 });
    fireEvent.mouseUp(firstRow());
    fireEvent.click(firstRow());
    expect(onTrackSelect).toHaveBeenNthCalledWith(1, tracks[0], false);
    expect(onTrackSelect).toHaveBeenNthCalledWith(2, tracks[0], true);
  });

  it.each(['mouse', 'touch'])('selects once after a 500 ms %s hold without playing', (input) => {
    const onTrackSelect = vi.fn();
    const onPlayTrack = vi.fn();
    renderOverlay(Overlay, { onTrackSelect, onPlayTrack });
    if (input === 'mouse') fireEvent.mouseDown(firstRow(), { button: 0 });
    else fireEvent.touchStart(firstRow());
    act(() => vi.advanceTimersByTime(499));
    expect(onTrackSelect).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onTrackSelect).toHaveBeenCalledExactlyOnceWith(tracks[0], false);
    expect(screen.getByRole('button', { name: 'Select Song 1' })).toBeInTheDocument();
    if (input === 'mouse') fireEvent.mouseUp(firstRow());
    else fireEvent.touchEnd(firstRow());
    act(() => vi.advanceTimersByTime(1000));
    expect(onTrackSelect).toHaveBeenCalledTimes(1);
    expect(onPlayTrack).not.toHaveBeenCalled();
  });

  it.each([
    'mouseUp',
    'mouseLeave',
    'touchEnd',
    'touchMove',
    'touchCancel',
  ])('cancels on %s', (end) => {
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onTrackSelect });
    if (end.startsWith('touch')) fireEvent.touchStart(firstRow());
    else fireEvent.mouseDown(firstRow(), { button: 0 });
    act(() => vi.advanceTimersByTime(300));
    fireEvent[end as 'mouseUp' | 'mouseLeave' | 'touchEnd' | 'touchMove' | 'touchCancel'](
      firstRow(),
    );
    act(() => vi.advanceTimersByTime(500));
    expect(onTrackSelect).not.toHaveBeenCalled();
  });

  it('does not treat a secondary mouse press as selection', () => {
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onTrackSelect });
    fireEvent.mouseDown(firstRow(), { button: 2 });
    act(() => vi.advanceTimersByTime(500));
    expect(onTrackSelect).not.toHaveBeenCalled();
  });

  it('does not select while holding a row checkbox', () => {
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onTrackSelect, selectedTrackIds: ['t1'] });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Deselect Song 1' }), { button: 0 });
    act(() => vi.advanceTimersByTime(500));
    expect(onTrackSelect).not.toHaveBeenCalled();
  });

  it('cancels a hold when the album tracks are replaced', () => {
    const onTrackSelect = vi.fn();
    const { rerenderOverlay } = renderOverlay(Overlay, { onTrackSelect });
    fireEvent.mouseDown(firstRow(), { button: 0 });
    act(() => vi.advanceTimersByTime(300));
    rerenderOverlay({ onTrackSelect, tracks: [makeTrack(4)] });
    act(() => vi.advanceTimersByTime(500));
    expect(onTrackSelect).not.toHaveBeenCalled();
  });

  it('uses the latest selection callback during a hold', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerenderOverlay } = renderOverlay(Overlay, { onTrackSelect: first });
    fireEvent.mouseDown(firstRow(), { button: 0 });
    act(() => vi.advanceTimersByTime(300));
    rerenderOverlay({ onTrackSelect: latest });
    act(() => vi.advanceTimersByTime(200));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith(tracks[0], false);
  });

  it('keeps only the newest pending row hold', () => {
    const onTrackSelect = vi.fn();
    renderOverlay(Overlay, { onTrackSelect });
    const rows = within(screen.getByRole('grid')).getAllByRole('row');
    fireEvent.mouseDown(rows[1], { button: 0 });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.mouseDown(rows[2], { button: 0 });
    act(() => vi.advanceTimersByTime(500));
    expect(onTrackSelect).toHaveBeenCalledExactlyOnceWith(tracks[1], false);
  });

  it('cancels selection when a context menu opens during the hold', () => {
    const onTrackSelect = vi.fn();
    const onTrackContextMenu = vi.fn();
    renderOverlay(Overlay, { onTrackSelect, onTrackContextMenu });
    fireEvent.mouseDown(firstRow(), { button: 0 });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.contextMenu(firstRow());
    act(() => vi.advanceTimersByTime(500));
    expect(onTrackContextMenu).toHaveBeenCalledOnce();
    expect(onTrackSelect).not.toHaveBeenCalled();
  });

  it('cancels a pending hold on unmount', () => {
    const onTrackSelect = vi.fn();
    const { unmount } = renderOverlay(Overlay, { onTrackSelect });
    fireEvent.mouseDown(firstRow(), { button: 0 });
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(onTrackSelect).not.toHaveBeenCalled();
  });
});
