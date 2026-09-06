import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppOverlayMessages } from './AppOverlayMessages';

const baseProps = {
  appError: null,
  playlistRepair: null,
  theme: 'liquid-glass' as const,
  onDismissError: vi.fn(),
  onRetryPlaylistLoad: vi.fn(),
  onResetPlaylistData: vi.fn(),
  onOpenPlaylistsDataFolder: vi.fn(),
};

describe('AppOverlayMessages', () => {
  it('wires dismissal for app errors and uses semantic error state styling', () => {
    const onDismissError = vi.fn();

    render(
      <AppOverlayMessages
        {...baseProps}
        onDismissError={onDismissError}
        appError={{ message: 'Audio output unavailable', detail: 'Using the system default.' }}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-[var(--state-error-surface)]');
    expect(alert).toHaveTextContent('Audio output unavailable');
    expect(alert).toHaveTextContent('Using the system default.');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(onDismissError).toHaveBeenCalledOnce();
  });

  it('keeps playlist repair actions available', () => {
    const onRetryPlaylistLoad = vi.fn();
    const onResetPlaylistData = vi.fn();
    const onOpenPlaylistsDataFolder = vi.fn();

    render(
      <AppOverlayMessages
        {...baseProps}
        onRetryPlaylistLoad={onRetryPlaylistLoad}
        onResetPlaylistData={onResetPlaylistData}
        onOpenPlaylistsDataFolder={onOpenPlaylistsDataFolder}
        playlistRepair={{
          reason: 'The playlist file could not be parsed.',
          attemptedRecovery: true,
          recoveredFrom: null,
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveClass('bg-[var(--state-warning-surface)]');

    fireEvent.click(screen.getByRole('button', { name: 'Retry load' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset playlists file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open data folder' }));

    expect(onRetryPlaylistLoad).toHaveBeenCalledOnce();
    expect(onResetPlaylistData).toHaveBeenCalledOnce();
    expect(onOpenPlaylistsDataFolder).toHaveBeenCalledOnce();
  });
});
