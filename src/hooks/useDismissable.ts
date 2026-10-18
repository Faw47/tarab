import { type RefObject, useEffect, useRef } from 'react';

/**
 * Closes an open popover on Escape or on a pointer press outside `containerRef`. Escape is taken
 * in the capture phase and marked handled, so app-wide Escape shortcuts (Back, clear selection) do
 * not also run; focus returns to `returnFocusRef`.
 */
export function useDismissable(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        onDismissRef.current();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onDismissRef.current();
      returnFocusRef?.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, containerRef, returnFocusRef]);
}
