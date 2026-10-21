import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from '../TopBar';
import { TopBarNeo } from '../TopBarNeo';

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

describe('neo search metadata direction (FE-22)', () => {
  it('lets the search input resolve Arabic query direction', () => {
    render(
      <TopBarNeo
        navMode="topNav"
        currentView="home"
        onNavigate={vi.fn()}
        searchQuery="فيروز (Live)"
        onSearchChange={vi.fn()}
        isScanning={false}
        scanProgress={0}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Search library' })).toHaveAttribute('dir', 'auto');
  });
});

describe('command palette discovery (FE-35)', () => {
  it('offers both top bars a button that opens the command palette', () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    render(
      <div>
        <TopBar
          navMode="topNav"
          currentView="home"
          onNavigate={vi.fn()}
          searchQuery=""
          onSearchChange={vi.fn()}
          isScanning={false}
          scanProgress={0}
        />
        <TopBarNeo
          navMode="topNav"
          currentView="home"
          onNavigate={vi.fn()}
          searchQuery=""
          onSearchChange={vi.fn()}
          isScanning={false}
          scanProgress={0}
        />
      </div>,
    );

    const buttons = screen.getAllByRole('button', { name: /open command palette/i });
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => fireEvent.click(button));
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tarab:open-command-palette' }),
    );
  });
});

describe('keyboard shortcuts discovery (FE-36)', () => {
  it('offers both top bars a button that opens the keyboard shortcuts sheet', () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    render(
      <div>
        <TopBar
          navMode="topNav"
          currentView="home"
          onNavigate={vi.fn()}
          searchQuery=""
          onSearchChange={vi.fn()}
          isScanning={false}
          scanProgress={0}
        />
        <TopBarNeo
          navMode="topNav"
          currentView="home"
          onNavigate={vi.fn()}
          searchQuery=""
          onSearchChange={vi.fn()}
          isScanning={false}
          scanProgress={0}
        />
      </div>,
    );

    const buttons = screen.getAllByRole('button', { name: /keyboard shortcuts/i });
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => fireEvent.click(button));
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tarab:open-keyboard-shortcuts' }),
    );
  });
});
