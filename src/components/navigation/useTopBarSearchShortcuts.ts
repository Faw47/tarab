import { type RefObject, useEffect, useMemo } from 'react';

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('input, textarea, select, [contenteditable]') !== null;
};

export function useTopBarSearchShortcuts({
  inputId,
  inputIds,
  inputRef,
  getInput,
  onFocusSearch,
  onClearSearch,
}: {
  inputId?: string;
  inputIds?: readonly string[];
  inputRef?: RefObject<HTMLInputElement | null>;
  getInput?: () => HTMLInputElement | null;
  onFocusSearch: () => void;
  onClearSearch: () => void;
}) {
  const searchInputIds = useMemo(() => inputIds ?? (inputId ? [inputId] : []), [inputId, inputIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const isSearchInput = target ? searchInputIds.includes(target.id) : false;
      const isSlash =
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === '/';

      if (isSlash) {
        if (isTextEntryTarget(target) && !isSearchInput) return;
        event.preventDefault();
        onFocusSearch();
        return;
      }

      const activeInput = getInput?.() ?? inputRef?.current ?? null;
      if (event.key !== 'Escape' || !activeInput || document.activeElement !== activeInput) return;
      event.preventDefault();
      if (activeInput.value) {
        onClearSearch();
        activeInput.focus();
      } else {
        activeInput.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [getInput, inputId, inputIds, inputRef, onClearSearch, onFocusSearch, searchInputIds]);
}
