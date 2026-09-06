import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('../../components/navigation', () => ({
  FloatingDock: () => null,
}));

vi.mock('../../components/player/PlayerView', () => {
  return {
    PlayerView: ({ onClose }: { onClose: () => void }) => (
      <button type="button" data-collapse-player onClick={onClose}>
        Collapse player
      </button>
    ),
  };
});

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogLayerProvider,
  DialogTitle,
} from '../../components/ui/dialog';
import { AppTransientSurfaces, preloadGlobalCommandPalette } from './AppTransientSurfaces';

function FullPlayerHarness({
  children,
  onCloseFullPlayer,
  showFullPlayer = true,
}: {
  children?: ReactNode;
  onCloseFullPlayer: () => void;
  showFullPlayer?: boolean;
}) {
  return (
    <DialogLayerProvider layer="above-full-player">
      <AppTransientSurfaces
        currentView="home"
        theme="liquid-glass"
        reducedEffects={false}
        showDropOverlay={false}
        showFullPlayer={showFullPlayer}
        showScanComplete={false}
        hasCurrentTrack={true}
        miniPlayerCollapsed={false}
        isPlaying={false}
        isScanning={false}
        onNavigate={vi.fn()}
        onShuffleAll={vi.fn(async () => undefined)}
        onTogglePlayback={vi.fn(async () => undefined)}
        onNextTrack={vi.fn(async () => undefined)}
        onPreviousTrack={vi.fn(async () => undefined)}
        onRescanLibrary={vi.fn(async () => undefined)}
        onOpenFullPlayer={vi.fn()}
        onCloseFullPlayer={onCloseFullPlayer}
      />
      {children}
    </DialogLayerProvider>
  );
}

describe('AppTransientSurfaces full-player dialogs', () => {
  it('restores the opener after rerenders while the full player is open', async () => {
    const onCloseFullPlayer = vi.fn();
    const view = render(
      <FullPlayerHarness showFullPlayer={false} onCloseFullPlayer={onCloseFullPlayer}>
        <button type="button">Open full player</button>
      </FullPlayerHarness>,
    );

    const opener = screen.getByRole('button', { name: 'Open full player' });
    opener.focus();
    view.rerender(
      <FullPlayerHarness onCloseFullPlayer={onCloseFullPlayer}>
        <button type="button">Open full player</button>
      </FullPlayerHarness>,
    );

    const playerControl = await screen.findByRole('button', { name: 'Collapse player' });
    playerControl.focus();
    view.rerender(
      <FullPlayerHarness onCloseFullPlayer={() => undefined}>
        <button type="button">Open full player</button>
      </FullPlayerHarness>,
    );
    view.rerender(
      <FullPlayerHarness showFullPlayer={false} onCloseFullPlayer={onCloseFullPlayer}>
        <button type="button">Open full player</button>
      </FullPlayerHarness>,
    );

    await waitFor(() => expect(opener).toHaveFocus());
  });
  it('elevates app-hosted dialogs and lets them own focus and Escape', async () => {
    const onCloseFullPlayer = vi.fn();
    const onDialogOpenChange = vi.fn();

    render(
      <FullPlayerHarness onCloseFullPlayer={onCloseFullPlayer}>
        <Dialog open onOpenChange={onDialogOpenChange}>
          <DialogContent>
            <DialogTitle>App action</DialogTitle>
            <DialogDescription>App-hosted dialog</DialogDescription>
            <button type="button">Continue</button>
          </DialogContent>
        </Dialog>
      </FullPlayerHarness>,
    );

    const appDialog = await screen.findByRole('dialog', { name: 'App action' });
    expect(appDialog).toHaveAttribute('data-dialog-layer', 'above-full-player');
    expect(appDialog).toHaveClass('z-[var(--layer-dialog-above-full-player)]');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus());

    fireEvent.keyDown(appDialog, { key: 'Escape' });
    expect(onDialogOpenChange).toHaveBeenCalledWith(false);
    expect(onCloseFullPlayer).not.toHaveBeenCalled();
  });

  it('elevates the command palette and lets its Radix dialog own Escape', async () => {
    const onCloseFullPlayer = vi.fn();
    render(<FullPlayerHarness onCloseFullPlayer={onCloseFullPlayer} />);

    await act(async () => {
      await preloadGlobalCommandPalette();
    });
    act(() => window.dispatchEvent(new Event('tarab:open-command-palette')));

    const palette = await screen.findByRole('dialog', { name: 'Global commands' });
    expect(palette).toHaveAttribute('data-dialog-layer', 'above-full-player');
    await waitFor(() => expect(screen.getByPlaceholderText('Type a command…')).toHaveFocus());

    fireEvent.keyDown(palette, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Global commands' })).not.toBeInTheDocument(),
    );
    expect(onCloseFullPlayer).not.toHaveBeenCalled();
  });
});
