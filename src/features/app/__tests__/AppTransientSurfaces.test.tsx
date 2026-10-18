import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { AppTransientSurfaces } from '../AppTransientSurfaces';

vi.mock('../../../components/navigation/GlobalCommandPalette', () => ({
  GlobalCommandPalette: () => null,
}));
vi.mock('../../../components/player/PlayerView', () => ({ PlayerView: () => null }));
vi.mock('../../../components/navigation', () => ({ FloatingDock: () => null }));

function renderSurfaces(onCloseFullPlayer: () => void, dialogOnTop?: () => void) {
  const noop = vi.fn(async () => undefined);
  render(
    <>
      <AppTransientSurfaces
        currentView="home"
        theme="liquid-glass"
        showDropOverlay={false}
        showFullPlayer
        showScanComplete={false}
        hasCurrentTrack
        isPlaying={false}
        isScanning={false}
        onNavigate={vi.fn()}
        onShuffleAll={noop}
        onTogglePlayback={noop}
        onNextTrack={noop}
        onPreviousTrack={noop}
        onRescanLibrary={noop}
        onOpenFullPlayer={vi.fn()}
        onCloseFullPlayer={onCloseFullPlayer}
      />
      {dialogOnTop ? (
        <ConfirmDialog title="Discard?" message="m" onConfirm={vi.fn()} onCancel={dialogOnTop} />
      ) : null}
    </>,
  );
}

describe('AppTransientSurfaces full player Escape (FE-25)', () => {
  it('closes the full player on Escape', () => {
    const onClose = vi.fn();
    renderSurfaces(onClose);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the full player open when a dialog above it already handled Escape', () => {
    const onClose = vi.fn();
    renderSurfaces(onClose);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    document.body.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('one Escape closes only a real dialog open above the full player', () => {
    const onClose = vi.fn();
    const onCancelDialog = vi.fn();
    renderSurfaces(onClose, onCancelDialog);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Discard?' }), { key: 'Escape' });
    expect(onCancelDialog).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
