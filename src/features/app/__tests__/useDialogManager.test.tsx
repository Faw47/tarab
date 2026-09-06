import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { useDialogManager } from '../useDialogManager';

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: `/${id}.mp3`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

describe('useDialogManager', () => {
  it('deduplicates playlist ids and closes the context menu', () => {
    const onCloseContextMenu = vi.fn();
    const { result } = renderHook(() => useDialogManager({ onCloseContextMenu }));
    const [one, two] = [makeTrack('one'), makeTrack('two')];

    act(() => result.current.openPlaylistPicker([one, one, two]));

    expect(result.current.showPlaylistPicker).toBe(true);
    expect(result.current.playlistPickerTrackIds).toEqual(['one', 'two']);
    expect(onCloseContextMenu).toHaveBeenCalledTimes(1);

    act(() => result.current.closePlaylistPicker());
    expect(result.current.showPlaylistPicker).toBe(false);
    expect(result.current.playlistPickerTrackIds).toEqual([]);
  });

  it('keeps tag and confirm dialog state explicit', () => {
    const { result } = renderHook(() => useDialogManager());
    const track = makeTrack('one');

    act(() => result.current.openTagEditor([]));
    expect(result.current.tagEditorTracks).toBeNull();

    act(() => result.current.openTagEditor([track]));
    expect(result.current.tagEditorTracks).toEqual([track]);

    act(() =>
      result.current.setConfirmDialog({
        title: 'Confirm',
        message: 'Confirm action',
        confirmLabel: 'Continue',
        onConfirm: vi.fn(),
      }),
    );
    expect(result.current.confirmDialog?.title).toBe('Confirm');

    act(() => {
      result.current.closeTagEditor();
      result.current.closeConfirmDialog();
    });
    expect(result.current.tagEditorTracks).toBeNull();
    expect(result.current.confirmDialog).toBeNull();
  });
});
