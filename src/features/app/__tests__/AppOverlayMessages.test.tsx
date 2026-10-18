import { render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppLayouts } from '../AppLayouts';
import { AppOverlayMessages } from '../AppOverlayMessages';

vi.mock('../../../components/navigation', () => ({ Sidebar: () => null }));
vi.mock('../../../components/navigation/TopBar', () => ({ TopBar: () => null }));
vi.mock('../../../components/navigation/TopBarNeo', () => ({ TopBarNeo: () => null }));
vi.mock('../../../components/player/MiniPlayer', () => ({
  MiniPlayer: () => <div data-testid="mini-player" />,
}));
vi.mock('../../../components/player/PillMiniPlayer', () => ({ PillMiniPlayer: () => null }));
vi.mock('../../../components/shell/LiquidHomeAmbientBackdrop', () => ({
  LiquidHomeAmbientBackdrop: () => null,
}));

function layoutProps(overrides: Record<string, unknown> = {}) {
  const noop = vi.fn();
  return {
    theme: 'neobrutalism',
    navMode: 'topNav',
    currentView: 'library',
    currentViewContent: <p>page</p>,
    overlayMessages: <div data-testid="overlay" />,
    compactMode: false,
    reducedEffects: true,
    backgroundEnabled: false,
    shellVars: {},
    palette: {},
    isScrolled: false,
    searchFocused: false,
    headerPointerRef: { current: null },
    shellScanBurstKey: 0,
    homeAmbientCoverUrl: null,
    showSearchShell: false,
    searchQuery: '',
    isScanning: false,
    scanProgress: 0,
    titlebarInsetLeft: 0,
    isSearching: false,
    focusSearchNonce: 0,
    isAlbumView: false,
    canGoBack: false,
    currentTrack: null,
    showFullPlayer: false,
    miniPlayerCollapsed: false,
    sleepDeadline: null,
    onNavigate: noop,
    onOpenSearchShell: noop,
    onFocusSearch: noop,
    onBrowseLibrary: noop,
    onSearchChange: noop,
    onSearchFocusChange: noop,
    onShuffleAll: noop,
    onBack: noop,
    onScrollChange: noop,
    onOpenFullPlayer: noop,
    onExpandCollapsedPlayer: noop,
    scheduleSleepTimer: noop,
    cancelSleepTimer: noop,
    ...overrides,
  } as unknown as ComponentProps<typeof AppLayouts>;
}

describe('AppOverlayMessages (FE-10, FE-31)', () => {
  it('drops below the transparent album-view header', () => {
    const props = {
      playlistRepair: null,
      playbackRecovery: <div role="alert">Playback stopped</div>,
      theme: 'liquid-glass' as const,
      onRetryPlaylistLoad: vi.fn(),
      onResetPlaylistData: vi.fn(),
      onOpenPlaylistsDataFolder: vi.fn(),
    };
    const { rerender } = render(<AppOverlayMessages {...props} />);
    const stack = () => screen.getByRole('alert').parentElement as HTMLElement;
    expect(stack().className).toContain('top-4');
    rerender(<AppOverlayMessages {...props} belowHeader />);
    expect(stack().className).toContain('top-[4.5rem]');
  });

  it('keeps the neobrutalism banner outside the scrolling page', () => {
    const props = layoutProps();
    render(<AppLayouts {...props} />);
    const overlay = screen.getByTestId('overlay');
    expect(overlay.closest('.overflow-y-auto')).toBeNull();
    expect(screen.getByText('page').closest('.overflow-y-auto')).not.toBeNull();
  });
});

describe('player bar motion (FE-29)', () => {
  const track = { id: 't1', title: 'Song', artist: 'A' };

  it('appears without animating when effects are reduced', async () => {
    render(
      <AppLayouts
        {...layoutProps({ theme: 'liquid-glass', reducedEffects: true, currentTrack: track })}
      />,
    );
    const bar = screen.getByTestId('mini-player').parentElement as HTMLElement;
    await waitFor(() => expect(bar.style.opacity).toBe('1'), { timeout: 150 });
  });

  it('animates in otherwise', async () => {
    render(
      <AppLayouts
        {...layoutProps({ theme: 'liquid-glass', reducedEffects: false, currentTrack: track })}
      />,
    );
    const bar = screen.getByTestId('mini-player').parentElement as HTMLElement;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(Number(bar.style.opacity)).toBeLessThan(1);
  });
});
