import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppLayouts } from '../AppLayouts';
import { AppOverlayMessages } from '../AppOverlayMessages';

vi.mock('../../../components/navigation', () => ({ Sidebar: () => null }));
vi.mock('../../../components/navigation/TopBar', () => ({ TopBar: () => null }));
vi.mock('../../../components/navigation/TopBarNeo', () => ({ TopBarNeo: () => null }));
vi.mock('../../../components/player/MiniPlayer', () => ({ MiniPlayer: () => null }));
vi.mock('../../../components/player/PillMiniPlayer', () => ({ PillMiniPlayer: () => null }));
vi.mock('../../../components/shell/LiquidHomeAmbientBackdrop', () => ({
  LiquidHomeAmbientBackdrop: () => null,
}));

describe('AppOverlayMessages (FE-31)', () => {
  it('announces the error banner as an alert', () => {
    render(
      <AppOverlayMessages
        appError={{ message: 'Unexpected application error', detail: 'boom' }}
        playlistRepair={null}
        theme="liquid-glass"
        onDismissError={vi.fn()}
        onRetryPlaylistLoad={vi.fn()}
        onResetPlaylistData={vi.fn()}
        onOpenPlaylistsDataFolder={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unexpected application error');
  });

  it('keeps the neobrutalism banner outside the scrolling page', () => {
    const noop = vi.fn();
    const props = {
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
    } as unknown as ComponentProps<typeof AppLayouts>;
    render(<AppLayouts {...props} />);
    const overlay = screen.getByTestId('overlay');
    expect(overlay.closest('.overflow-y-auto')).toBeNull();
    expect(screen.getByText('page').closest('.overflow-y-auto')).not.toBeNull();
  });
});
