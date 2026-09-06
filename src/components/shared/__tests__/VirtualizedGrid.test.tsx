import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    const grid = screen.getByRole('grid', { name: 'Library items' });
    expect(grid).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getAllByRole('gridcell')).toHaveLength(3);
    const firstCell = screen.getAllByRole('gridcell')[0];
    expect(firstCell).toHaveAttribute('aria-colindex', '1');
    expect(grid).toHaveAttribute('aria-activedescendant', firstCell.id);

    const one = screen.getByRole('button', { name: 'One' });
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus());
    expect(grid).toHaveAttribute('aria-activedescendant', screen.getAllByRole('gridcell')[1].id);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Two' }), { key: 'End' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Three' })).toHaveFocus());
    expect(scrollToIndex).toHaveBeenLastCalledWith(2, { align: 'auto' });
  });
  it('uses the active descendant when the grid container has focus', async () => {
    render(
      <VirtualizedGrid
        items={['One', 'Two', 'Three']}
        minColumnWidth={100}
        renderItem={(item) => <button type="button">{item}</button>}
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Library items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus());
    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'auto' });
  });
  it('holds the near-end lock until an async load request settles', async () => {
    let resolveRequest!: () => void;
    const onScrollNearEnd = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const view = render(
      <VirtualizedGrid
        items={['One']}
        minColumnWidth={100}
        onScrollNearEnd={onScrollNearEnd}
        renderItem={(item) => <button type="button">{item}</button>}
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Library items' });
    Object.defineProperties(grid, {
      scrollTop: { configurable: true, value: 90 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 100 },
    });
    fireEvent.scroll(grid);
    fireEvent.scroll(grid);

    expect(onScrollNearEnd).toHaveBeenCalledOnce();

    await act(async () => {
      resolveRequest();
      await Promise.resolve();
    });
    view.unmount();
  });
  it('releases the near-end throttle when the callback is replaced', async () => {
    let resolveFirst!: () => void;
    const firstRequest = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const secondRequest = vi.fn(() => Promise.resolve());
    const view = render(
      <VirtualizedGrid
        items={['One']}
        minColumnWidth={100}
        onScrollNearEnd={firstRequest}
        renderItem={(item) => <button type="button">{item}</button>}
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Library items' });
    Object.defineProperties(grid, {
      scrollTop: { configurable: true, value: 90 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 100 },
    });
    fireEvent.scroll(grid);
    expect(firstRequest).toHaveBeenCalledOnce();

    view.rerender(
      <VirtualizedGrid
        items={['One']}
        minColumnWidth={100}
        onScrollNearEnd={secondRequest}
        renderItem={(item) => <button type="button">{item}</button>}
      />,
    );

    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    fireEvent.scroll(grid);
    expect(secondRequest).toHaveBeenCalledOnce();
    view.unmount();
  });
});
