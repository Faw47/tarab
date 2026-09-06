import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div data-testid="motion-layout" className={className}>
        {children}
      </div>
    ),
  },
}));

vi.mock('../../components/navigation', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));
vi.mock('../../components/navigation/TopBar', () => ({
  TopBar: () => <div data-testid="top-bar" />,
}));
vi.mock('../../components/navigation/TopBarNeo', () => ({
  TopBarNeo: () => <div data-testid="top-bar-neo" />,
}));
vi.mock('../../components/player/MiniPlayer', () => ({
  MiniPlayer: () => <div data-testid="mini-player" />,
}));
vi.mock('../../components/player/PillMiniPlayer', () => ({
  PillMiniPlayer: ({ className }: { className?: string }) => (
    <div data-testid="pill-mini-player" className={className} />
  ),
}));
vi.mock('../../components/shell/AppShellLiquidWebGL', () => ({
  AppShellLiquidWebGL: () => <div data-testid="liquid-shell-webgl" />,
}));
vi.mock('../../components/shell/LiquidHomeAmbientBackdrop', () => ({
  LiquidHomeAmbientBackdrop: ({ coverUrl }: { coverUrl: string | null }) => (
    <div data-testid="ambient-backdrop" data-cover-url={coverUrl ?? ''} />
  ),
}));

import { AppLayouts, type AppLayoutsProps } from './AppLayouts';

const baseProps = {
  theme: 'neobrutalism',
  navMode: 'iconRail',
  currentView: 'home',
  currentViewContent: <div data-testid="view-content" />,
  overlayMessages: <div data-testid="overlay-messages" />,
  compactMode: false,
  reducedEffects: false,
  backgroundEnabled: true,
  shellVars: {},
  palette: {},
  isScrolled: false,
  headerPointerRef: { current: null },
  shellScanBurstKey: 0,
  homeAmbientCoverUrl: null,
  showSearchShell: false,
  searchQuery: '',
  isScanning: false,
  scanProgress: 0,
  activeProcessing: undefined,
  titlebarInsetLeft: 0,
  isSearching: false,
  focusSearchNonce: 0,
  isAlbumView: false,
  canGoBack: false,
  currentTrack: null,
  showFullPlayer: false,
  miniPlayerCollapsed: false,
  sleepDeadline: null,
  onNavigate: vi.fn(),
  onOpenSearchShell: vi.fn(),
  onFocusSearch: vi.fn(),
  onBrowseLibrary: vi.fn(),
  onSearchChange: vi.fn(),
  onSearchFocusChange: vi.fn(),
  onShuffleAll: vi.fn(),
  onBack: vi.fn(),
  onScrollChange: vi.fn(),
  onOpenFullPlayer: vi.fn(),
  onExpandCollapsedPlayer: vi.fn(),
  scheduleSleepTimer: vi.fn(),
  cancelSleepTimer: vi.fn(),
} as unknown as AppLayoutsProps;

describe('AppLayouts responsive navigation', () => {
  it('keeps the Neo icon rail desktop-only so mobile uses the floating dock', () => {
    render(<AppLayouts {...baseProps} />);

    expect(screen.getByRole('complementary')).toHaveClass('hidden', 'lg:flex');
  });
  it('keeps a collapsed Neo player available through the pill control', () => {
    const currentTrack = {
      id: 'track-1',
      title: 'Track',
      artist: 'Artist',
      album: 'Album',
      year: null,
      duration: 180,
      filePath: '/music/track.mp3',
      hasCoverArt: false,
      dateAdded: 0,
    } satisfies Track;

    render(<AppLayouts {...baseProps} currentTrack={currentTrack} miniPlayerCollapsed />);

    expect(screen.queryByTestId('mini-player')).not.toBeInTheDocument();
    const pill = screen.getByTestId('pill-mini-player');
    expect(pill).toHaveClass('relative');
    expect(pill.parentElement).toHaveClass('bottom-24', 'lg:bottom-6');
  });

  it('removes route-transition motion when effects are reduced', () => {
    const props = {
      ...baseProps,
      theme: 'liquid-glass',
      navMode: 'topNav',
      currentView: 'library',
    } as AppLayoutsProps;

    const { unmount } = render(<AppLayouts {...props} reducedEffects />);
    expect(screen.queryAllByTestId('motion-layout')).toHaveLength(0);

    unmount();
    render(<AppLayouts {...props} reducedEffects={false} />);
    expect(screen.queryAllByTestId('motion-layout')).toHaveLength(1);
  });

  it('does not mount WebGL or cover-art ambience when effects are reduced', () => {
    const props = {
      ...baseProps,
      theme: 'liquid-glass',
      navMode: 'topNav',
      homeAmbientCoverUrl: 'cover-art://hash/large',
      reducedEffects: true,
    } as AppLayoutsProps;

    render(<AppLayouts {...props} />);

    expect(screen.queryByTestId('liquid-shell-webgl')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ambient-backdrop')).not.toBeInTheDocument();
  });

  it('mounts the optional liquid surfaces when effects and background are enabled', async () => {
    const props = {
      ...baseProps,
      theme: 'liquid-glass',
      navMode: 'topNav',
      homeAmbientCoverUrl: 'cover-art://hash/large',
      reducedEffects: false,
    } as AppLayoutsProps;

    render(<AppLayouts {...props} />);

    await waitFor(() => {
      expect(screen.getByTestId('liquid-shell-webgl')).toBeInTheDocument();
      expect(screen.getByTestId('ambient-backdrop')).toHaveAttribute(
        'data-cover-url',
        'cover-art://hash/large',
      );
    });
  });
});
