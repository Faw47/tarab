import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';

const items: ContextMenuItem[] = [
  { id: 'play', label: 'Play', onClick: vi.fn() },
  { id: 'disabled', label: 'Disabled', disabled: true, onClick: vi.fn() },
  { id: 'remove', label: 'Remove', danger: true, onClick: vi.fn() },
];

describe('ContextMenu', () => {
  it('focuses the first enabled item on open and restores previous focus on close', async () => {
    const onClose = vi.fn();
    const view = render(
      <>
        <button type="button">Before</button>
        <ContextMenu position={null} items={items} onClose={onClose} />
      </>,
    );

    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();
    view.rerender(
      <>
        <button type="button">Before</button>
        <ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={onClose} />
      </>,
    );

    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Play' })).toHaveFocus());

    view.rerender(
      <>
        <button type="button">Before</button>
        <ContextMenu position={null} items={items} onClose={onClose} />
      </>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus());
  });

  it('moves focus with arrow keys and skips disabled items', async () => {
    render(<ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={vi.fn()} />);

    const menu = screen.getByRole('menu', { name: 'Track actions' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Play' })).toHaveFocus());

    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
  });

  it('supports typeahead and closes after an enabled action', async () => {
    const onClose = vi.fn();
    render(<ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={onClose} />);

    const menu = screen.getByRole('menu', { name: 'Track actions' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Play' })).toHaveFocus());

    fireEvent.keyDown(menu, { key: 'r' });
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not reset focus when menu item data changes while open', async () => {
    const onClose = vi.fn();
    const view = render(
      <>
        <button type="button">Before</button>
        <ContextMenu position={null} items={items} onClose={onClose} />
      </>,
    );
    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();
    const openMenu = () =>
      view.rerender(
        <>
          <button type="button">Before</button>
          <ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={onClose} />
        </>,
      );
    openMenu();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Play' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Track actions' }), { key: 'ArrowDown' });

    const updatedItems = items.map((item) =>
      item.id === 'play' ? { ...item, label: 'Play updated' } : item,
    );
    view.rerender(
      <>
        <button type="button">Before</button>
        <ContextMenu position={{ x: 12, y: 12 }} items={updatedItems} onClose={onClose} />
      </>,
    );

    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
  });

  it('closes after a synchronous action failure', async () => {
    const onClose = vi.fn();
    const actionError = new Error('action failed');
    const onClick = vi.fn(() => {
      throw actionError;
    });
    const handleGlobalError = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener('error', handleGlobalError);

    try {
      render(
        <ContextMenu
          position={{ x: 10, y: 10 }}
          items={[{ id: 'failing', label: 'Failing action', onClick }]}
          onClose={onClose}
        />,
      );

      fireEvent.click(screen.getByRole('menuitem', { name: 'Failing action' }));
      expect(onClick).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      await waitFor(() => expect(handleGlobalError).toHaveBeenCalled());
    } finally {
      window.removeEventListener('error', handleGlobalError);
    }
  });
});
