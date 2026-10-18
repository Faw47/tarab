import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from '../TopBar';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => () => undefined),
  }),
}));

describe('TopBar search', () => {
  it('focuses the visible desktop search input from the slash shortcut', async () => {
    // Regression for FE-04: both inputs shared one ref and id, and the hidden compact input won.
    const { container } = render(
      <TopBar
        navMode="topNav"
        currentView="home"
        onNavigate={vi.fn()}
        searchQuery=""
        onSearchChange={vi.fn()}
        isScanning={false}
        scanProgress={0}
      />,
    );

    const ids = Array.from(container.querySelectorAll('input')).map((input) => input.id);
    expect(new Set(ids).size).toBe(ids.length);

    fireEvent.keyDown(document.body, { key: '/' });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

    expect(document.activeElement?.id).toBe('global-library-search');
  });
});
