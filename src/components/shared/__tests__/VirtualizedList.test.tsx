import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VirtualizedList } from '../VirtualizedList';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      [
        { index: 1, key: 'item-1', size: 40, start: 40 },
        { index: 2, key: 'item-2', size: 40, start: 80 },
      ].filter((item) => item.index < count),
    getTotalSize: () => 120,
    scrollToIndex: () => undefined,
  }),
}));

describe('VirtualizedList accessibility', () => {
  it('exposes set size and position for the rendered list items', () => {
    render(
      <VirtualizedList
        items={['One', 'Two', 'Three']}
        itemHeight={40}
        containerProps={{ 'aria-label': 'Upcoming tracks' }}
        renderItem={(item) => <span>{item}</span>}
      />,
    );

    expect(screen.getByRole('list', { name: 'Upcoming tracks' })).toBeInTheDocument();
    const secondTrack = screen.getByRole('listitem', { name: 'Two' });
    expect(secondTrack).toHaveAttribute('aria-setsize', '3');
    expect(secondTrack).toHaveAttribute('aria-posinset', '2');
  });
});
