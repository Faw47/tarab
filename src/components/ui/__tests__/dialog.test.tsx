import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogLayerProvider, DialogTitle } from '../dialog';
import { InputDialog } from '../InputDialog';

vi.mock('../liquid-glass', () => ({
  useGlassSystem: () => ({ theme: 'dark', reducedEffects: true }),
  usePrefersReducedMotion: () => false,
  usePointerTracker: () => ({
    ref: { current: null },
    measure: () => null,
    scheduleUpdate: () => undefined,
    clearVars: () => undefined,
    invalidateRect: () => undefined,
  }),
}));

vi.mock('../button', () => ({
  Button: ({ children, ...props }: ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('../IconButton', () => ({
  IconButton: ({ children, ...props }: ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('../Input', () => ({
  Input: (props: ComponentProps<'input'> & { theme?: string }) => <input {...props} />,
}));

describe('Dialog layers', () => {
  it('keeps the default portal on the normal dialog layer', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Default dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const content = screen.getByRole('dialog');
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(content).toHaveAttribute('data-dialog-layer', 'default');
    expect(content).toHaveClass('z-[var(--layer-dialog)]');
    expect(overlay).toHaveAttribute('data-dialog-layer', 'default');
  });

  it('inherits the above-full-player layer through the portal', () => {
    const { container } = render(
      <DialogLayerProvider layer="above-full-player">
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Player child dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogLayerProvider>,
    );

    const content = screen.getByRole('dialog');
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(container.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(content).toHaveAttribute('data-dialog-layer', 'above-full-player');
    expect(content).toHaveClass('z-[var(--layer-dialog-above-full-player)]');
    expect(overlay).toHaveAttribute('data-dialog-layer', 'above-full-player');
    expect(overlay).toHaveClass('z-[var(--layer-dialog-above-full-player)]');
  });

  it('provides an accessible description for input dialogs', () => {
    render(
      <InputDialog
        title="Rename playlist"
        label="Playlist name"
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Playlist name for Rename playlist.',
    );
  });
});
