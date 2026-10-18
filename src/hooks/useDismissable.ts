import { type RefObject, useEffect, useRef } from 'react';

/**
 * Closes an open popover on Escape or on a pointer press outside `containerRef`.
 *
 * Escape is handled in the bubble phase on document, after any dialog layer (Radix handles it in
 * the capture phase and marks it handled), and only while focus is in the popover or nowhere, so
 * an Escape meant for a dialog above the popover never closes it. The handler marks the key
 * handled, so the window-level shortcuts (Back, clear selection) do not also run, and returns focus
 * to `returnFocusRef` only when focus was inside the popover.
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
      const container = containerRef.current;
      const active = document.activeElement;
      const focusInside = Boolean(container && active && container.contains(active));
      if (!focusInside && active && active !== document.body) return;
      event.preventDefault();
      onDismissRef.current();
      if (focusInside) returnFocusRef?.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, containerRef, returnFocusRef]);
}
