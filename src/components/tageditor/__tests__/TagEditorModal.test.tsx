import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLyricsForTrack, writeLyricsForTrack, writeTags } from '../../../lib/tauri-commands';
import type { Track } from '../../../types';
import { lyricsEquivalent } from '../LyricsEditor';
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

function renderLyricsTab() {
  const onClose = vi.fn();
  render(
    <TagEditorModal tracks={[track]} onClose={onClose} onSave={vi.fn()} initialTab="lyrics" />,
  );
  return { onClose };
}

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

  it('does not call reformatted but unedited lyrics a change', async () => {
    const loaded = '[ti:Song]\r\n[00:01.234] Hello\r\n[00:05.00] World\r\n';
    vi.mocked(getLyricsForTrack).mockResolvedValueOnce(loaded);
    const { onClose } = renderLyricsTab();
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Changes/ })).toBeEnabled());
    // The loaded text survives the editor mounting before it arrived.
    expect(screen.getByText('World')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByText('Hello'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Save Changes also writes edited lyrics', async () => {
    vi.mocked(getLyricsForTrack).mockResolvedValueOnce('[00:01.00] Hello\n[00:05.00] World');
    vi.mocked(writeTags).mockResolvedValueOnce({ status: 'success' } as never);
    const { onClose } = renderLyricsTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Changes/ })).toBeEnabled());
    const [deleteFirst] = await screen.findAllByRole('button', { name: 'Delete line' });
    fireEvent.click(deleteFirst);
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(writeLyricsForTrack).toHaveBeenCalledWith('/music/a.flac', '[00:05.00] World');
  });

  it('Escape in a lyric line edit cancels that edit and keeps the editor open', async () => {
    vi.mocked(getLyricsForTrack).mockResolvedValueOnce('[00:01.00] Hello');
    const { onClose } = renderLyricsTab();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit lyric text' }))[0]);
    const input = screen.getByRole('textbox', { name: 'Edit lyric text' });
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Edit lyric text' })).toBeNull(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});

describe('lyricsEquivalent', () => {
  it('ignores LRC formatting but not text changes', () => {
    expect(lyricsEquivalent('[00:01.50] A\r\n', '[00:01.500]A')).toBe(true);
    expect(lyricsEquivalent('[00:01.50] A', '[00:01.50] B')).toBe(false);
    expect(lyricsEquivalent('plain words', 'other words')).toBe(false);
  });
});
