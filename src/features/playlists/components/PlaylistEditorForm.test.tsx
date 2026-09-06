import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaylistEditorForm } from './PlaylistEditorForm';

vi.mock('../../../store/settings-store', () => {
  const useSettingsStore = (selector: (state: { theme: string }) => unknown) =>
    selector({ theme: 'liquid-glass' });
  return { useSettingsStore };
});
vi.mock('../../../lib/tauri-commands', () => ({
  selectLibraryFolder: vi.fn(),
}));
vi.mock('../../../lib/report-error', () => ({ reportError: vi.fn() }));

describe('PlaylistEditorForm labels', () => {
  it('associates the name and playlist type controls with their labels', () => {
    render(<PlaylistEditorForm mode="create" onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Manual' })).toBeInTheDocument();
  });

  it('associates conditional smart-rule fields with their labels', () => {
    render(<PlaylistEditorForm mode="create" onCancel={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Smart' }));

    expect(screen.getByLabelText('Smart rule')).toBeInTheDocument();
    expect(screen.getByLabelText('Days')).toBeInTheDocument();
  });

  it('renders the genre field when the genre rule is selected', () => {
    render(<PlaylistEditorForm mode="create" onCancel={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Smart' }));
    fireEvent.change(screen.getByLabelText('Smart rule'), {
      target: { value: 'ByGenre' },
    });

    expect(screen.getByLabelText('Genre contains')).toBeInTheDocument();
  });
});
