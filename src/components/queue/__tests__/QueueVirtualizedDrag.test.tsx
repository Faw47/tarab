import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import type { Track } from '../../../types';
import { QueueView } from '../QueueView';

vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(),
  DndContext: ({
    children,
    onDragStart,
    onDragCancel,
  }: {
    children: ReactNode;
    onDragStart?: (event: unknown) => void;
    onDragCancel?: () => void;
  }) => (
    <div>
      {children}
      <button type="button" onClick={() => onDragStart?.({})}>
        Start queue drag
      </button>
      <button type="button" onClick={() => onDragCancel?.()}>
        Cancel queue drag
      </button>
    </div>
  ),
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

vi.mock('../../shared/VirtualizedList', () => ({
  VirtualizedList: ({
    items,
    overscan,
    renderItem,
  }: {
    items: Track[];
    overscan: number;
    renderItem: (item: Track, index: number) => ReactNode;
  }) => (
    <div
      data-testid="queue-virtualized-list"
      data-item-count={items.length}
      data-overscan={overscan}
    >
      {items.slice(0, 1).map((item, index) => (
        <div key={item._queueId || item.id}>{renderItem(item, index)}</div>
      ))}
    </div>
  ),
}));

vi.mock('../../shared/CoverArtImage', () => ({ CoverArtImage: () => null }));
vi.mock('../../../lib/playback-actions', () => ({
  startPlayback: vi.fn(),
  toggleCurrentPlayback: vi.fn(),
}));

const makeTrack = (index: number): Track => ({
  id: `track-${index}`,
  filePath: `/music/track-${index}.mp3`,
  title: `Track ${index}`,
  artist: 'Artist',
  album: 'Album',
  year: 2026,
  duration: 60,
  hasCoverArt: false,
  dateAdded: index,
});

describe('QueueView virtualization during drag', () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: 'liquid-glass' });
    const queue = Array.from({ length: 101 }, (_, index) => makeTrack(index));
    usePlayerStore.setState({
      queue,
      queueIndex: 0,
      currentTrack: queue[0],
      isPlaying: false,
    });
  });

  it('mounts offscreen sortable rows while a queue drag is active', () => {
    render(<QueueView onNavigateToLibrary={vi.fn()} />);

    expect(screen.getByTestId('queue-virtualized-list')).toHaveAttribute('data-overscan', '8');

    fireEvent.click(screen.getByRole('button', { name: 'Start queue drag' }));

    expect(screen.getByTestId('queue-virtualized-list')).toHaveAttribute('data-overscan', '100');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel queue drag' }));

    expect(screen.getByTestId('queue-virtualized-list')).toHaveAttribute('data-overscan', '8');
  });
});
