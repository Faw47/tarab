import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportErrorMock } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
}));

vi.mock('../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

vi.mock('../../lib/tauri-commands', () => ({
  selectLibraryFolder: vi.fn(),
}));

vi.mock('../../store/settings-store', () => ({
  useSettingsStore: (selector: (state: { theme: string }) => unknown) =>
    selector({ theme: 'dark' }),
}));

import { PlaylistEditorDialog } from './PlaylistEditorDialog';

const fillName = () => {
  fireEvent.change(screen.getByPlaceholderText('My playlist'), {
    target: { value: 'Late Night' },
  });
};

describe('PlaylistEditorDialog save lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the editor open when saving fails', async () => {
    const error = new Error('database unavailable');
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(error);

    render(<PlaylistEditorDialog open mode="create" onClose={onClose} onSave={onSave} />);
    fillName();

    const saveButton = screen.getByRole('button', { name: 'Create' });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(reportErrorMock).toHaveBeenCalledWith('Failed to save playlist', {
        source: 'playlist-editor-form',
        error,
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('My playlist')).toHaveValue('Late Night');
  });

  it('closes the editor after a successful save', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<PlaylistEditorDialog open mode="create" onClose={onClose} onSave={onSave} />);
    fillName();

    const saveButton = screen.getByRole('button', { name: 'Create' });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
