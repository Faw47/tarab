import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeMenuActions } from './useNativeMenuActions';

const mocks = vi.hoisted(() => ({
  eventHandler: undefined as ((event: { payload: string }) => void) | undefined,
  focusMain: vi.fn(async () => undefined),
  navigate: vi.fn(),
}));

vi.mock('../../hooks/useTauriEvent', () => ({
  useTauriEvent: (_eventName: string, handler: (event: { payload: string }) => void) => {
    mocks.eventHandler = handler;
  },
}));

vi.mock('../../lib/tauri-commands', () => ({
  desktopFocusMainWindow: mocks.focusMain,
  listLibraryGrants: vi.fn(async () => []),
  selectLibraryFolder: vi.fn(async () => null),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock('../../platform/dialog', () => ({
  dialog: { openAudioFiles: vi.fn(async () => null) },
}));

vi.mock('../../lib/report-error', () => ({ reportError: vi.fn() }));

describe('useNativeMenuActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventHandler = undefined;
    mocks.focusMain.mockResolvedValue(undefined);
  });

  it('serializes focus and navigation in native menu event order', async () => {
    let releaseFirstFocus: (() => void) | undefined;
    mocks.focusMain.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseFirstFocus = () => resolve(undefined);
        }),
    );
    renderHook(() =>
      useNativeMenuActions({
        navigate: mocks.navigate,
        openSearch: vi.fn(),
        setFullPlayerVisible: vi.fn(),
        setLibraryFolders: vi.fn(),
        scanFolder: vi.fn(async () => undefined),
      }),
    );

    mocks.eventHandler?.({ payload: 'view.home' });
    mocks.eventHandler?.({ payload: 'view.queue' });
    await waitFor(() => expect(mocks.focusMain).toHaveBeenCalledTimes(1));
    expect(mocks.navigate).not.toHaveBeenCalled();

    releaseFirstFocus?.();
    await waitFor(() => expect(mocks.navigate).toHaveBeenNthCalledWith(1, 'home'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenNthCalledWith(2, 'queue'));
    expect(mocks.focusMain).toHaveBeenCalledTimes(2);
  });
});
