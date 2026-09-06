import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagEditorModal } from './TagEditorModal';

const commandMocks = vi.hoisted(() => ({
  getCoverArtData: vi.fn(),
  getLyricsForTrack: vi.fn(),
  pickCoverArt: vi.fn(),
  readFullTags: vi.fn(),
  removeCoverArt: vi.fn(),
  writeLyricsForTrack: vi.fn(),
  writeTags: vi.fn(),
  writeTagsBatch: vi.fn(),
}));
const pointerTracker = vi.hoisted(() => ({
  ref: { current: null },
  measure: vi.fn(),
  scheduleUpdate: vi.fn(),
  clearVars: vi.fn(),
  invalidateRect: vi.fn(),
}));

vi.mock('../../hooks/useCoverArt', () => ({ useCoverArt: () => null }));
vi.mock('../../lib/tauri-commands', () => commandMocks);
vi.mock('../../lib/track-refresh', () => ({ refreshTracksByFilePaths: vi.fn() }));
vi.mock('../../platform/clipboard', () => ({
  clipboard: { writeText: vi.fn(async () => true) },
}));
vi.mock('../../store/metadata-clipboard-store', () => ({
  useMetadataClipboardStore: () => ({
    setClipboard: vi.fn(),
    data: null,
    coverArt: null,
    buildTagUpdateFromInfo: vi.fn(() => ({})),
    canPaste: () => false,
  }),
}));
vi.mock('../metadata/MetadataClipboard', () => ({ MetadataClipboard: () => null }));
vi.mock('../ui/liquid-glass', () => ({
  useGlassSystem: () => ({ theme: 'dark', reducedEffects: true }),
  usePointerTracker: () => pointerTracker,
  usePrefersReducedMotion: () => true,
}));
vi.mock('./LyricsEditor', () => ({
  LyricsEditor: ({ lyricsContent }: { lyricsContent: string }) => (
    <output data-testid="lyrics-content">{lyricsContent}</output>
  ),
}));
vi.mock('./TagEditorArtworkPanel', () => ({ TagEditorArtworkPanel: () => null }));
vi.mock('./TagEditorFileInfo', () => ({ TagEditorFileInfo: () => null }));
vi.mock('./TagEditorMetadataForm', () => ({ TagEditorMetadataForm: () => null }));

describe('TagEditorModal', () => {
  it('settles safely without reading tags when no tracks are provided', async () => {
    render(<TagEditorModal tracks={[]} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(
      await screen.findByText(
        'No tracks selected. Close this editor and choose at least one track.',
      ),
    ).toBeInTheDocument();
    expect(commandMocks.readFullTags).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('ignores a stale lyrics response after switching to another track', async () => {
    const firstTrack = {
      id: 'first',
      title: 'First',
      artist: 'Artist',
      album: 'Album',
      duration: 120,
      filePath: 'C:/music/first.mp3',
      hasCoverArt: false,
      year: null,
      dateAdded: 0,
    };
    const secondTrack = {
      ...firstTrack,
      id: 'second',
      title: 'Second',
      filePath: 'C:/music/second.mp3',
    };
    commandMocks.readFullTags.mockResolvedValue({
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: null,
      trackNumber: null,
      discNumber: null,
      genre: '',
      composer: '',
      comment: '',
      extraTags: {},
    });

    let resolveFirst: ((value: string) => void) | undefined;
    commandMocks.getLyricsForTrack.mockImplementation((filePath: string) => {
      if (filePath === firstTrack.filePath) {
        return new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve('new lyrics');
    });

    const view = render(
      <TagEditorModal
        tracks={[firstTrack]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        initialTab="lyrics"
      />,
    );
    await waitFor(() => expect(resolveFirst).toEqual(expect.any(Function)));

    view.rerender(
      <TagEditorModal
        tracks={[secondTrack]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        initialTab="lyrics"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('lyrics-content')).toHaveTextContent('new lyrics'),
    );

    await act(async () => {
      resolveFirst?.('stale lyrics');
    });
    expect(screen.getByTestId('lyrics-content')).toHaveTextContent('new lyrics');
    expect(screen.getByTestId('lyrics-content')).not.toHaveTextContent('stale lyrics');
  });
});
