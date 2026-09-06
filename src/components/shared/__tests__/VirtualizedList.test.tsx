import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VirtualizedList } from '../VirtualizedList';

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

describe('VirtualizedList', () => {
  it('moves roving focus through track rows with boundary keys', async () => {
    render(
      <VirtualizedList
        items={['One', 'Two', 'Three']}
        itemHeight={100}
        keyboardNavigation
        containerProps={{ role: 'list', 'aria-label': 'Test list' }}
        renderItem={(item) => (
          <div role="button" tabIndex={0}>
            {item}
          </div>
        )}
      />,
    );

    expect(screen.getByRole('list', { name: 'Test list' })).toBeInTheDocument();
    const one = screen.getByRole('button', { name: 'One' });
    const two = screen.getByRole('button', { name: 'Two' });
    expect(one).toHaveAttribute('tabindex', '0');
    expect(two).toHaveAttribute('tabindex', '-1');

    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    await waitFor(() => expect(two).toHaveFocus());
    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'auto' });
  });

  it('keeps listbox options from being nested inside generated listitem wrappers', async () => {
    render(
      <VirtualizedList
        items={['One', 'Two']}
        itemHeight={100}
        keyboardNavigation
        containerProps={{
          role: 'listbox',
          'aria-label': 'Options',
          tabIndex: 0,
        }}
        renderItem={(item, index) => (
          <div id={`option-${index}`} role="option" aria-selected={index === 0}>
            {item}
          </div>
        )}
      />,
    );

    const listbox = screen.getByRole('listbox', { name: 'Options' });
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(listbox).toHaveAttribute('aria-activedescendant', 'option-0');
    expect(screen.getByRole('option', { name: 'One' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('option', { name: 'Two' })).toHaveAttribute('tabindex', '-1');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Options' }), {
      key: 'ArrowDown',
    });
    await waitFor(() => expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'auto' }));
  });
  it('preserves caller active-descendant state when shared navigation is disabled', () => {
    render(
      <VirtualizedList
        items={['One']}
        itemHeight={100}
        containerProps={{
          role: 'listbox',
          'aria-label': 'Caller-managed options',
          'aria-activedescendant': 'external-option',
        }}
        renderItem={() => (
          <div id="external-option" role="option">
            One
          </div>
        )}
      />,
    );

    expect(screen.getByRole('listbox', { name: 'Caller-managed options' })).toHaveAttribute(
      'aria-activedescendant',
      'external-option',
    );
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
      <VirtualizedList
        items={['One']}
        itemHeight={100}
        containerProps={{ role: 'list', 'aria-label': 'Load more test' }}
        onScrollNearEnd={onScrollNearEnd}
        renderItem={(item) => <div>{item}</div>}
      />,
    );

    const list = screen.getByRole('list', { name: 'Load more test' });
    Object.defineProperties(list, {
      scrollTop: { configurable: true, value: 90 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 100 },
    });
    fireEvent.scroll(list);
    fireEvent.scroll(list);

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
      <VirtualizedList
        items={['One']}
        itemHeight={100}
        containerProps={{ role: 'list', 'aria-label': 'Reload callback test' }}
        onScrollNearEnd={firstRequest}
        renderItem={(item) => <div>{item}</div>}
      />,
    );

    const list = screen.getByRole('list', { name: 'Reload callback test' });
    Object.defineProperties(list, {
      scrollTop: { configurable: true, value: 90 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 100 },
    });
    fireEvent.scroll(list);
    expect(firstRequest).toHaveBeenCalledOnce();

    view.rerender(
      <VirtualizedList
        items={['One']}
        itemHeight={100}
        containerProps={{ role: 'list', 'aria-label': 'Reload callback test' }}
        onScrollNearEnd={secondRequest}
        renderItem={(item) => <div>{item}</div>}
      />,
    );

    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    fireEvent.scroll(list);
    expect(secondRequest).toHaveBeenCalledOnce();
    view.unmount();
  });
  it('uses an explicit row focus target instead of a nested action button', () => {
    render(
      <VirtualizedList
        items={['One', 'Two']}
        itemHeight={100}
        keyboardNavigation
        containerProps={{ role: 'list', 'aria-label': 'Explicit targets' }}
        renderItem={(item) => (
          <div data-virtual-list-focus-target role="option" tabIndex={0}>
            <button type="button">{item}</button>
          </div>
        )}
      />,
    );

    const targets = Array.from(
      document.querySelectorAll<HTMLElement>('[data-virtual-list-focus-target]'),
    );
    expect(targets[0]).toHaveAttribute('tabindex', '0');
    expect(targets[1]).toHaveAttribute('tabindex', '-1');
  });
});
