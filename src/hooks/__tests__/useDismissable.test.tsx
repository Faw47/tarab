import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useDismissable } from '../useDismissable';

function Popover() {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useDismissable(open, ref, () => setOpen(false), toggle);
  return (
    <>
      <p>outside</p>
      <div ref={ref}>
        <button ref={toggle} type="button" onClick={() => setOpen((o) => !o)}>
          Vol
        </button>
        {open ? <div role="dialog">segments</div> : null}
      </div>
    </>
  );
}

describe('useDismissable (FE-16)', () => {
  it('closes on Escape, marks it handled and returns focus', () => {
    render(<Popover />);
    screen.getByRole('button', { name: 'Vol' }).focus();
    // fireEvent returns false when a listener called preventDefault.
    const notHandled = fireEvent.keyDown(screen.getByRole('button', { name: 'Vol' }), {
      key: 'Escape',
    });
    expect(notHandled).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Vol' })).toHaveFocus();
  });

  it('closes on a press outside, not inside', () => {
    render(<Popover />);
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves Escape to a focused dialog above the popover', () => {
    render(
      <>
        <Popover />
        <div role="dialog" aria-modal="true" aria-label="Command palette">
          <input aria-label="Search commands" />
        </div>
      </>,
    );
    const search = screen.getByRole('textbox', { name: 'Search commands' });
    search.focus();
    const notHandled = fireEvent.keyDown(search, { key: 'Escape' });
    expect(notHandled).toBe(true);
    expect(screen.getByText('segments')).toBeInTheDocument();
    expect(search).toHaveFocus();
  });
});
