import { type RefObject, useEffect } from 'react';

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('input, textarea, select, [contenteditable]') !== null;
};

export function useTopBarSearchShortcuts({
  inputId,
  inputRef,
  onFocusSearch,
  onClearSearch,
}: {
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onFocusSearch: () => void;
  onClearSearch: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const isSearchInput = target?.id === inputId;
      const isSlash =
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === '/';

      if (isSlash) {
        if (isTextEntryTarget(target) && !isSearchInput) return;
        event.preventDefault();
        onFocusSearch();
        return;
      }

      if (event.key !== 'Escape' || document.activeElement !== inputRef.current) return;
      event.preventDefault();
      if (inputRef.current?.value) {
        onClearSearch();
        inputRef.current.focus();
      } else {
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputId, inputRef, onClearSearch, onFocusSearch]);
}
