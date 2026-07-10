import { useCallback, useState } from 'react';
import type { NavView } from '../../components/navigation';
import type { NavMode } from '../../store/settings-store';

interface AppSearchShellOptions {
  navigate: (view: NavView) => void;
  navMode: NavMode;
  searchQuery: string;
}

export function useAppSearchShell({ navigate, navMode, searchQuery }: AppSearchShellOptions) {
  const [showSearchShell, setShowSearchShell] = useState(false);
  const [searchFocusNonce, setSearchFocusNonce] = useState(0);
  const [shellSearchFocused, setShellSearchFocused] = useState(false);

  const focusSearch = useCallback(() => {
    setSearchFocusNonce((nonce) => nonce + 1);
  }, []);

  const openSearchShell = useCallback(() => {
    setShowSearchShell(true);
    focusSearch();
  }, [focusSearch]);

  const closeSearchShell = useCallback(() => {
    setShowSearchShell(false);
  }, []);

  const openGlobalSearch = useCallback(() => {
    navigate('library');
    openSearchShell();
  }, [navigate, openSearchShell]);

  const handleSearchFocusChange = useCallback(
    (focused: boolean) => {
      setShellSearchFocused(focused);
      if (focused || navMode !== 'iconRail' || searchQuery.trim()) return;

      queueMicrotask(() => {
        const bar = document.querySelector('[data-app-top-bar]');
        const activeElement = document.activeElement;
        if (bar && activeElement instanceof Node && bar.contains(activeElement)) return;
        setShowSearchShell(false);
      });
    },
    [navMode, searchQuery],
  );

  return {
    showSearchShell,
    searchFocusNonce,
    shellSearchFocused,
    focusSearch,
    openSearchShell,
    closeSearchShell,
    openGlobalSearch,
    handleSearchFocusChange,
  };
}
