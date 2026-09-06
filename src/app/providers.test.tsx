import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';

const { settingsState } = vi.hoisted(() => ({
  settingsState: { theme: 'liquid-glass' as 'liquid-glass' | 'neobrutalism' },
}));

vi.mock('../store/settings-store', () => ({
  useSettingsStore: <T,>(selector: (state: typeof settingsState) => T) => selector(settingsState),
}));

vi.mock('@tanstack/react-query-persist-client', () => ({
  PersistQueryClientProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('react-hotkeys-hook', () => ({
  HotkeysProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('sonner', () => ({
  Toaster: ({ theme }: { theme: string }) => (
    <div data-sonner-theme={theme} data-testid="toaster" />
  ),
}));

describe('AppProviders', () => {
  beforeEach(() => {
    settingsState.theme = 'liquid-glass';
  });

  it('keeps toast presentation aligned with the active app theme', () => {
    const view = render(
      <AppProviders>
        <div>content</div>
      </AppProviders>,
    );

    expect(screen.getByTestId('toaster')).toHaveAttribute('data-sonner-theme', 'dark');

    settingsState.theme = 'neobrutalism';
    view.rerender(
      <AppProviders>
        <div>content</div>
      </AppProviders>,
    );

    expect(screen.getByTestId('toaster')).toHaveAttribute('data-sonner-theme', 'light');
  });
});
