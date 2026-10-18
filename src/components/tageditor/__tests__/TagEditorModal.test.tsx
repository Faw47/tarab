import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { TagEditorModal } from '../TagEditorModal';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock('../../../hooks/useCoverArt', () => ({ useCoverArt: () => null }));
vi.mock('../../../lib/tauri-commands', () => ({
  getCoverArtData: vi.fn(async () => null),
  getLyricsForTrack: vi.fn(async () => null),
  readFullTags: vi.fn(async () => ({ filePath: '/music/a.flac', title: 'Original', artist: 'A' })),
  readImageAsBase64: vi.fn(),
  removeCoverArt: vi.fn(),
  selectImageFile: vi.fn(),
  writeLyricsForTrack: vi.fn(),
  writeTags: vi.fn(),
  writeTagsBatch: vi.fn(),
}));

const track: Track = {
  id: 't1',
  filePath: '/music/a.flac',
  title: 'Original',
  artist: 'A',
  album: '',
  year: 2020,
  duration: 100,
  hasCoverArt: false,
  dateAdded: 0,
};

async function renderEditor() {
  const onClose = vi.fn();
  render(<TagEditorModal tracks={[track]} onClose={onClose} onSave={vi.fn()} />);
  const title = await screen.findByPlaceholderText('Track title');
  await waitFor(() => expect(title).toHaveValue('Original'));
  return { onClose, title };
}

describe('TagEditorModal unsaved changes (FE-25)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('closes on Escape straight away when nothing changed', async () => {
    const { onClose, title } = await renderEditor();
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding edits, and Keep editing keeps them', async () => {
    const { onClose, title } = await renderEditor();
    fireEvent.change(title, { target: { value: 'Edited' } });
    fireEvent.keyDown(title, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByText('Discard unsaved changes?')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Track title')).toHaveValue('Edited');
  });

  it('Cancel with edits asks first, and Discard closes', async () => {
    const { onClose, title } = await renderEditor();
    fireEvent.change(title, { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reverting an edit makes the form clean again', async () => {
    const { onClose, title } = await renderEditor();
    fireEvent.change(title, { target: { value: 'Edited' } });
    fireEvent.change(title, { target: { value: 'Original' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks Escape handled so the full player under it stays open', async () => {
    const { title } = await renderEditor();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    title.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
