import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';

const pointerTracker = vi.hoisted(() => ({
  ref: { current: null },
  measure: vi.fn(),
  scheduleUpdate: vi.fn(),
  clearVars: vi.fn(),
  invalidateRect: vi.fn(),
}));

vi.mock('../liquid-glass', () => ({
  useGlassSystem: () => ({ theme: 'neobrutalism', reducedEffects: false }),
  usePointerTracker: () => pointerTracker,
  usePrefersReducedMotion: () => false,
}));

describe('ConfirmDialog', () => {
  it('disables every action while an asynchronous decision is resolving', () => {
    const onConfirm = vi.fn();
    const onSecondary = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        title="Open audio file"
        message="Choose how to open the file."
        confirmLabel="Play once"
        secondaryLabel="Import folder"
        busy
        onConfirm={onConfirm}
        onSecondary={onSecondary}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    for (const name of ['Close', 'Cancel', 'Import folder', 'Play once']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onSecondary).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
