import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TagInfo, Track } from '../../types';

const mocks = vi.hoisted(() => ({
  getLibraryTracks: vi.fn(),
  getCoverArtData: vi.fn(),
  pickCoverArt: vi.fn(),
  removeCoverArt: vi.fn(),
  writeTags: vi.fn(),
  readFullTags: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock('../../lib/tauri-commands', () => ({
  getCoverArtData: mocks.getCoverArtData,
  pickCoverArt: mocks.pickCoverArt,
  readFullTags: mocks.readFullTags,
  removeCoverArt: mocks.removeCoverArt,
  selectFolder: vi.fn(),
  writeTags: mocks.writeTags,
  writeTagsBatch: vi.fn(),
}));
vi.mock('../../lib/report-error', () => ({ reportError: mocks.reportError }));
vi.mock('../../lib/track-refresh', () => ({ refreshTracksByFilePaths: vi.fn() }));
vi.mock('./useTagManagerLibraryTracks', () => ({
  useTagManagerLibraryTracks: mocks.getLibraryTracks,
}));
vi.mock('../shared/CoverArtImage', () => ({ CoverArtImage: () => null }));
vi.mock('../shared/VirtualizedList', () => ({
  VirtualizedList: ({
    items,
    renderItem,
    containerProps,
  }: {
    items: Track[];
    renderItem: (item: Track, index: number) => ReactNode;
    containerProps?: HTMLAttributes<HTMLDivElement>;
  }) => (
    <div {...containerProps}>
      {items.map((item, index) => (
        <div key={item.id}>{renderItem(item, index)}</div>
      ))}
    </div>
  ),
}));
vi.mock('./TagManagerTrackRow', () => ({
  TagManagerTrackRow: ({ track }: { track: Track }) => <div>{track.title}</div>,
}));
vi.mock('../playlist/PlaylistPickerDialog', () => ({ PlaylistPickerDialog: () => null }));
vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: ({
    onConfirm,
    confirmLabel,
  }: {
    onConfirm: () => void | Promise<void>;
    confirmLabel: string;
  }) => (
    <button type="button" onClick={() => void onConfirm()}>
      {confirmLabel}
    </button>
  ),
}));
vi.mock('../ui/InputDialog', () => ({ InputDialog: () => null }));

import { TagManagerView } from './TagManagerView';

const firstTrack: Track = {
  id: 'first',
  title: 'First',
  artist: 'Artist',
  albumArtist: null,
  album: 'Album',
  year: null,
  duration: 120,
  filePath: 'C:/music/first.mp3',
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
};
const secondTrack: Track = {
  ...firstTrack,
  id: 'second',
  title: 'Second',
  filePath: 'C:/music/second.mp3',
};

const tagsFor = (track: Track): TagInfo => ({
  title: track.title,
  artist: track.artist,
  album: track.album,
  albumArtist: '',
  hasCoverArt: false,
  filePath: track.filePath,
  fileFormat: 'mp3',
  durationSecs: track.duration,
});

const baseProps = {
  onSelectionChange: vi.fn(),
  onToggleTrack: vi.fn(),
  onOpenTagEditor: vi.fn(),
  onRevealFiles: vi.fn(),
  onCopyMetadata: vi.fn(),
  onPasteMetadata: vi.fn(),
  onRenameTrack: vi.fn(),
  onMoveTracks: vi.fn(),
  onDeleteFiles: vi.fn(),
};

describe('TagManagerView metadata loading', () => {
  it('does not report a stale metadata failure after selection changes', async () => {
    mocks.getLibraryTracks.mockReturnValue({
      tracks: [firstTrack, secondTrack],
      loadedCount: 2,
      totalCount: 2,
      isHydrating: false,
      hydrationError: null,
      retryHydration: vi.fn(),
    });

    let rejectFirst: ((error: unknown) => void) | undefined;
    mocks.readFullTags.mockImplementation((filePath: string) => {
      if (filePath === firstTrack.filePath) {
        return new Promise<TagInfo>((_, reject) => {
          rejectFirst = reject;
        });
      }
      return Promise.resolve(tagsFor(secondTrack));
    });

    const view = render(<TagManagerView {...baseProps} selectedTracks={[firstTrack]} />);
    await waitFor(() => expect(rejectFirst).toEqual(expect.any(Function)));

    view.rerender(<TagManagerView {...baseProps} selectedTracks={[secondTrack]} />);
    await waitFor(() => expect(mocks.readFullTags).toHaveBeenCalledWith(secondTrack.filePath));

    await act(async () => {
      rejectFirst?.(new Error('first track disappeared'));
    });

    expect(mocks.reportError).not.toHaveBeenCalledWith('Failed to load tags', expect.anything());
  });
  it('does not report a metadata failure after the view unmounts', async () => {
    mocks.getLibraryTracks.mockReturnValue({
      tracks: [firstTrack],
      loadedCount: 1,
      totalCount: 1,
      isHydrating: false,
      hydrationError: null,
      retryHydration: vi.fn(),
    });
    let rejectRead: ((error: unknown) => void) | undefined;
    mocks.readFullTags.mockImplementation(
      () =>
        new Promise<TagInfo>((_, reject) => {
          rejectRead = reject;
        }),
    );

    const view = render(<TagManagerView {...baseProps} selectedTracks={[firstTrack]} />);
    await waitFor(() => expect(rejectRead).toEqual(expect.any(Function)));
    view.unmount();

    await act(async () => {
      rejectRead?.(new Error('metadata read finished after unmount'));
    });

    expect(mocks.reportError).not.toHaveBeenCalledWith('Failed to load tags', expect.anything());
  });

  it('resets a removed source folder after library data changes', async () => {
    const retryHydration = vi.fn();
    mocks.getLibraryTracks.mockReturnValue({
      tracks: [firstTrack],
      loadedCount: 1,
      totalCount: 1,
      isHydrating: false,
      hydrationError: null,
      retryHydration,
    });

    const view = render(<TagManagerView {...baseProps} selectedTracks={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Library source: All Library' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /music/ }));

    expect(screen.getByRole('button', { name: 'Library source: music' })).toBeInTheDocument();

    const replacementTrack = {
      ...firstTrack,
      id: 'replacement',
      title: 'Replacement',
      filePath: 'C:/other/replacement.mp3',
    };
    mocks.getLibraryTracks.mockReturnValue({
      tracks: [replacementTrack],
      loadedCount: 1,
      totalCount: 1,
      isHydrating: false,
      hydrationError: null,
      retryHydration,
    });
    view.rerender(<TagManagerView {...baseProps} selectedTracks={[]} />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Library source: All Library' }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('Unknown Folder')).not.toBeInTheDocument();
  });
  it('restores original cover artwork when undoing a save', async () => {
    mocks.getLibraryTracks.mockReturnValue({
      tracks: [firstTrack],
      loadedCount: 1,
      totalCount: 1,
      isHydrating: false,
      hydrationError: null,
      retryHydration: vi.fn(),
    });
    mocks.readFullTags.mockResolvedValue({
      ...tagsFor(firstTrack),
      hasCoverArt: true,
    });
    mocks.getCoverArtData.mockResolvedValue(['image/jpeg', 'old-art']);
    mocks.pickCoverArt.mockResolvedValue({
      mime: 'image/png',
      base64: 'new-art',
    });
    mocks.writeTags.mockResolvedValue({
      status: 'success',
      path: firstTrack.filePath,
    });

    render(<TagManagerView {...baseProps} selectedTracks={[firstTrack]} />);

    await waitFor(() => expect(mocks.readFullTags).toHaveBeenCalledWith(firstTrack.filePath));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Artwork...', hidden: true }));
    await waitFor(() => expect(mocks.pickCoverArt).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes', hidden: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mocks.writeTags).toHaveBeenCalledTimes(2));
    expect(mocks.writeTags).toHaveBeenLastCalledWith(
      firstTrack.filePath,
      expect.objectContaining({
        coverArtBase64: 'old-art',
        coverArtMime: 'image/jpeg',
      }),
    );
    expect(mocks.removeCoverArt).not.toHaveBeenCalled();
  });
  it('shows hydration failure counts and retry action', () => {
    const retryHydration = vi.fn();
    mocks.getLibraryTracks.mockReturnValue({
      tracks: [firstTrack],
      loadedCount: 1,
      totalCount: 3,
      isHydrating: false,
      hydrationError: 'network error',
      retryHydration,
    });

    render(<TagManagerView {...baseProps} selectedTracks={[]} />);

    expect(screen.getByRole('alert')).toHaveTextContent('1 / 3 tracks loaded. network error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryHydration).toHaveBeenCalledOnce();
  });
});
