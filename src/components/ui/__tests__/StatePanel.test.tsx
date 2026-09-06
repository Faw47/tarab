import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatePanel } from '../StatePanel';

vi.mock('../button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));

describe('StatePanel', () => {
  it('exposes errors as alerts and supports retry actions', () => {
    const onRetry = vi.fn();
    render(
      <StatePanel
        tone="error"
        title="Could not load the queue"
        description="Try again."
        action={{ label: 'Retry', onClick: onRetry }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the queue');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('uses a polite status for loading and renders child details', () => {
    render(
      <StatePanel tone="loading" title="Loading library data">
        <span>12 / 40 tracks</span>
      </StatePanel>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('12 / 40 tracks');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
