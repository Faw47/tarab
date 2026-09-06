import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTopBarController } from './useTopBarController';

type ControllerOptions = Parameters<typeof useTopBarController>[0];

const createOptions = (overrides: Partial<ControllerOptions> = {}): ControllerOptions => ({
  inputId: 'test-search',
  currentView: 'home',
  searchQuery: '',
  onSearchChange: vi.fn(),
  onNavigate: vi.fn(),
  isScanning: false,
  scanProgress: 0,
  ...overrides,
});

describe('useTopBarController', () => {
  it('shares search navigation and focus behavior between themes', () => {
    const options = createOptions({
      onSearchFocusChange: vi.fn(),
    });
    const { result, rerender } = renderHook(
      ({ currentView }: { currentView: string }) =>
        useTopBarController({ ...options, currentView }),
      { initialProps: { currentView: 'home' } },
    );

    act(() => result.current.handleSearchChange('  jazz  '));

    expect(options.onSearchChange).toHaveBeenCalledWith('  jazz  ');
    expect(options.onNavigate).toHaveBeenCalledWith('library');

    rerender({ currentView: 'library' });
    act(() => result.current.handleSearchChange('ambient'));
    expect(options.onNavigate).toHaveBeenCalledTimes(1);

    act(() => result.current.handleSearchFocus());
    act(() => result.current.handleSearchBlur());
    expect(options.onSearchFocusChange).toHaveBeenNthCalledWith(1, true);
    expect(options.onSearchFocusChange).toHaveBeenNthCalledWith(2, false);
  });

  it('derives status and shuffle visibility from the same model for both skins', () => {
    const onShuffleAll = vi.fn();
    const options = createOptions({
      currentView: 'library',
      isScanning: true,
      scanProgress: 42.4,
      activeProcessing: { label: 'Indexing library' },
      onShuffleAll,
    });
    const { result } = renderHook(() => useTopBarController(options));

    expect(result.current.showShuffle).toBe(true);
    expect(result.current.status).toEqual({
      label: 'Indexing library',
      shortLabel: 'Scanning',
      progressText: '42%',
      progressValue: 42,
    });
    expect(result.current.shortcutLabel).toBe('/');
    expect(result.current.ariaShortcut).toBe('Slash');
  });

  it('keeps the neobrutalist scanning label contract', () => {
    const { result } = renderHook(() =>
      useTopBarController(
        createOptions({
          isScanning: true,
          scanningLabel: 'Scanning Library',
        }),
      ),
    );

    expect(result.current.status?.label).toBe('Scanning Library');
  });

  it('focuses the visible responsive search input instead of a hidden breakpoint variant', () => {
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const { result } = renderHook(() =>
      useTopBarController(
        createOptions({
          inputIds: ['desktop-search', 'mobile-search'],
        }),
      ),
    );
    const hiddenInput = document.createElement('input');
    hiddenInput.id = 'desktop-search';
    hiddenInput.style.display = 'none';
    const visibleInput = document.createElement('input');
    visibleInput.id = 'mobile-search';
    document.body.append(hiddenInput, visibleInput);

    act(() => {
      result.current.registerSearchInput(0)(hiddenInput);
      result.current.registerSearchInput(1)(visibleInput);
      fireEvent.keyDown(window, { key: '/' });
    });

    expect(visibleInput).toHaveFocus();
    hiddenInput.remove();
    visibleInput.remove();
    vi.stubGlobal('requestAnimationFrame', previousRequestAnimationFrame);
  });

  it('cancels a queued focus callback when the controller unmounts', () => {
    const requestAnimationFrame = vi.fn(() => 42);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

    const { result, unmount } = renderHook(() => useTopBarController(createOptions()));

    act(() => result.current.focusSearchInput());
    unmount();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    vi.unstubAllGlobals();
  });
});
