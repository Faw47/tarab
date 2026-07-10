import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppSearchShell } from '../useAppSearchShell';

describe('useAppSearchShell', () => {
  it('opens global search, navigates to the library, and requests focus', () => {
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useAppSearchShell({ navigate, navMode: 'iconRail', searchQuery: '' }),
    );

    act(() => result.current.openGlobalSearch());

    expect(navigate).toHaveBeenCalledWith('library');
    expect(result.current.showSearchShell).toBe(true);
    expect(result.current.searchFocusNonce).toBe(1);
  });

  it('dismisses an empty icon-rail search after focus leaves the top bar', async () => {
    const { result } = renderHook(() =>
      useAppSearchShell({ navigate: vi.fn(), navMode: 'iconRail', searchQuery: '' }),
    );

    act(() => result.current.openSearchShell());
    await act(async () => {
      result.current.handleSearchFocusChange(false);
      await Promise.resolve();
    });

    expect(result.current.shellSearchFocused).toBe(false);
    expect(result.current.showSearchShell).toBe(false);
  });

  it('keeps search open while focus remains inside the top bar', async () => {
    const topBar = document.createElement('div');
    topBar.dataset.appTopBar = '';
    const input = document.createElement('input');
    topBar.appendChild(input);
    document.body.appendChild(topBar);
    input.focus();

    const { result, unmount } = renderHook(() =>
      useAppSearchShell({ navigate: vi.fn(), navMode: 'iconRail', searchQuery: '' }),
    );

    act(() => result.current.openSearchShell());
    await act(async () => {
      result.current.handleSearchFocusChange(false);
      await Promise.resolve();
    });

    expect(result.current.showSearchShell).toBe(true);

    unmount();
    topBar.remove();
  });

  it('keeps search open when it contains a query', async () => {
    const { result } = renderHook(() =>
      useAppSearchShell({ navigate: vi.fn(), navMode: 'iconRail', searchQuery: 'oud' }),
    );

    act(() => result.current.openSearchShell());
    await act(async () => {
      result.current.handleSearchFocusChange(false);
      await Promise.resolve();
    });

    expect(result.current.showSearchShell).toBe(true);
  });
});
