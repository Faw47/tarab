import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopMiniWindowSurface } from '../DesktopMiniWindowSurface';

const { palette, settings } = vi.hoisted(() => ({
  palette: {
    shellBlobA: '#1b1b2a',
    shellBlobB: '#0b0b10',
    heroAccent: '#6d5dfc',
    heroGlow: '#6d5dfc',
    surfaceTint: 'rgba(255,255,255,0.08)',
    primaryRgb: '109,93,252',
  },
  settings: { theme: 'neobrutalism' },
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(async () => undefined),
    startDragging: vi.fn(async () => undefined),
  }),
}));
vi.mock('../../../hooks/useReactivePalette', () => ({
  useReactivePalette: () => palette,
}));
vi.mock('../../../hooks/useTauriEvent', () => ({
  useTauriEvent: vi.fn(),
}));
vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: (selector: (state: { theme: string }) => unknown) => selector(settings),
}));

describe('DesktopMiniWindowSurface FE-38', () => {
  beforeEach(() => {
    settings.theme = 'neobrutalism';
  });

  it('provides a 24 px minimum seek target', () => {
    render(<DesktopMiniWindowSurface />);

    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveClass('min-h-6');
  });

  it('reflects the selected app theme in the mini window surface', () => {
    const { container } = render(<DesktopMiniWindowSurface />);

    expect(container.firstElementChild).toHaveAttribute('data-theme', 'neobrutalism');
  });
});
