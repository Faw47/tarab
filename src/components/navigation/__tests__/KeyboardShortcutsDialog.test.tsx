import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KeyboardShortcutsDialog } from '../KeyboardShortcutsDialog';

describe('KeyboardShortcutsDialog (FE-36)', () => {
  it('shows the documented playback, navigation, and search shortcuts after the event', async () => {
    render(<KeyboardShortcutsDialog theme="liquid-glass" />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent(window, new Event('tarab:open-keyboard-shortcuts'));

    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const content = within(dialog);
    expect(content.getByText('Focus library search')).toBeInTheDocument();
    expect(content.getByText('Open command palette')).toBeInTheDocument();
    expect(content.getByText('Play or pause')).toBeInTheDocument();
    expect(content.getByText('Previous track')).toBeInTheDocument();
    expect(content.getByText('Next track')).toBeInTheDocument();
    expect(content.queryByText('ArrowUp')).not.toBeInTheDocument();
    expect(content.queryByText('ArrowDown')).not.toBeInTheDocument();
  });
});
