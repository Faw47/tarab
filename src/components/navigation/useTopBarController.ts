import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NavView } from './navigation-model';
import {
  getTopBarStatus,
  shouldShowShuffle,
  TOP_BAR_SHORTCUT,
  type TopBarProcessingTask,
  type TopBarStatus,
} from './top-bar-model';
import { useTopBarSearchShortcuts } from './useTopBarSearchShortcuts';

interface UseTopBarControllerOptions {
  inputId: string;
  inputIds?: readonly string[];
  currentView: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNavigate: (view: NavView) => void;
  isScanning: boolean;
  scanProgress: number;
  activeProcessing?: TopBarProcessingTask;
  onShuffleAll?: () => void;
  focusSearchNonce?: number;
  onSearchFocusChange?: (focused: boolean) => void;
  autoFocusSearchSurface?: boolean;
  scanningLabel?: string;
}

export interface TopBarController {
  registerSearchInput: (index: number) => (node: HTMLInputElement | null) => void;
  isSearchFocused: boolean;
  shortcutLabel: string;
  ariaShortcut: string;
  status: TopBarStatus | null;
  showShuffle: boolean;
  focusSearchInput: () => void;
  handleSearchChange: (query: string) => void;
  handleSearchFocus: () => void;
  handleSearchBlur: () => void;
  handleSearchEscape: () => void;
  handleClearAndRefocus: () => void;
}

export function useTopBarController({
  inputId,
  inputIds,
  currentView,
  searchQuery,
  onSearchChange,
  onNavigate,
  isScanning,
  scanProgress,
  activeProcessing,
  onShuffleAll,
  focusSearchNonce = 0,
  onSearchFocusChange,
  autoFocusSearchSurface = false,
  scanningLabel,
}: UseTopBarControllerOptions): TopBarController {
  const searchInputNodesRef = useRef<Array<HTMLInputElement | null>>([]);
  const focusFrameRef = useRef<number | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const isSearchSurface = currentView === 'library' || currentView === 'search';
  const searchInputIds = useMemo(() => inputIds ?? (inputId ? [inputId] : []), [inputId, inputIds]);

  const registerSearchInput = useCallback(
    (index: number) => (node: HTMLInputElement | null) => {
      searchInputNodesRef.current[index] = node;
    },
    [],
  );

  const getActiveSearchInput = useCallback(() => {
    const inputs = searchInputNodesRef.current;
    const focused = inputs.find((input) => input === document.activeElement);
    if (focused) return focused;

    const visible = inputs.find((input) => {
      if (!input) return false;
      let element: HTMLElement | null = input;
      while (element) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        element = element.parentElement;
      }
      return true;
    });
    return visible ?? inputs.find((input): input is HTMLInputElement => input !== null) ?? null;
  }, []);

  const focusSearchInput = useCallback(() => {
    const focus = () => {
      const input = getActiveSearchInput();
      if (!input) return;
      input.focus();
      input.select();
    };

    if (focusFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }

    if (typeof requestAnimationFrame === 'function') {
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = null;
        focus();
      });
    } else focus();
  }, [getActiveSearchInput]);

  useEffect(
    () => () => {
      if (focusFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(focusFrameRef.current);
      }
      focusFrameRef.current = null;
    },
    [],
  );

  const updateSearchFocus = useCallback(
    (focused: boolean) => {
      setIsSearchFocused(focused);
      onSearchFocusChange?.(focused);
    },
    [onSearchFocusChange],
  );

  useLayoutEffect(() => {
    if (focusSearchNonce) focusSearchInput();
  }, [focusSearchNonce, focusSearchInput]);

  const handleSearchShortcutFocus = useCallback(() => {
    updateSearchFocus(true);
    focusSearchInput();
  }, [focusSearchInput, updateSearchFocus]);

  useEffect(() => {
    if (autoFocusSearchSurface && isSearchSurface && !searchQuery) focusSearchInput();
  }, [autoFocusSearchSurface, focusSearchInput, isSearchSurface, searchQuery]);

  const handleClearSearch = useCallback(() => {
    onSearchChange('');
  }, [onSearchChange]);

  useTopBarSearchShortcuts({
    inputIds: searchInputIds,
    getInput: getActiveSearchInput,
    onFocusSearch: handleSearchShortcutFocus,
    onClearSearch: handleClearSearch,
  });

  const handleSearchChange = useCallback(
    (query: string) => {
      onSearchChange(query);
      if (query.trim() && !isSearchSurface) onNavigate('library');
    },
    [isSearchSurface, onNavigate, onSearchChange],
  );

  const handleSearchFocus = useCallback(() => {
    updateSearchFocus(true);
  }, [updateSearchFocus]);

  const handleSearchBlur = useCallback(() => {
    updateSearchFocus(false);
  }, [updateSearchFocus]);

  const handleSearchEscape = useCallback(() => {
    if (searchQuery) {
      onSearchChange('');
      getActiveSearchInput()?.focus();
      return;
    }
    getActiveSearchInput()?.blur();
  }, [getActiveSearchInput, onSearchChange, searchQuery]);

  const handleClearAndRefocus = useCallback(() => {
    onSearchChange('');
    getActiveSearchInput()?.focus();
  }, [getActiveSearchInput, onSearchChange]);

  const status = useMemo(
    () =>
      getTopBarStatus({
        activeProcessing,
        isScanning,
        scanProgress,
        scanningLabel,
      }),
    [activeProcessing, isScanning, scanProgress, scanningLabel],
  );

  const showShuffle = shouldShowShuffle(currentView, onShuffleAll);

  return {
    registerSearchInput,
    isSearchFocused,
    shortcutLabel: TOP_BAR_SHORTCUT.shortcutLabel,
    ariaShortcut: TOP_BAR_SHORTCUT.ariaShortcut,
    status,
    showShuffle,
    focusSearchInput,
    handleSearchChange,
    handleSearchFocus,
    handleSearchBlur,
    handleSearchEscape,
    handleClearAndRefocus,
  };
}
