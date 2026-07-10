import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VirtualizedGrid } from '../VirtualizedGrid';

const { scrollToIndex } = vi.hoisted(() => ({ scrollToIndex: vi.fn() }));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: 100,
        start: index * 100,
      })),
    getTotalSize: () => count * 100,
    scrollToIndex,
  }),
}));

describe('VirtualizedGrid', () => {
  it('exposes grid semantics and moves focus with arrow and boundary keys', async () => {
    render(
      <VirtualizedGrid
        items={['One', 'Two', 'Three']}
        minColumnWidth={100}
        renderItem={(item) => <button type="button">{item}</button>}
      />,
    );

    expect(screen.getByRole('grid', { name: 'Library items' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getAllByRole('gridcell')).toHaveLength(3);

    const one = screen.getByRole('button', { name: 'One' });
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('button', { name: 'Two' }), { key: 'End' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Three' })).toHaveFocus());
    expect(scrollToIndex).toHaveBeenLastCalledWith(2, { align: 'auto' });
  });
});
