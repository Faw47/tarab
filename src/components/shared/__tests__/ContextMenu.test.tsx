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
    render(
      <>
        <button type="button">Before</button>
        <ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={onClose} />
      </>,
    );

    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();

    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Play' })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus with arrow keys and skips disabled items', async () => {
    render(<ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Play' })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });

    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
  });
});
