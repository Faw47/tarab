/**
 * Computes position for a context menu so it stays within the viewport on both axes.
 * Use for list rows, grid cards, and any trigger that opens a floating menu.
 */
export function getContextMenuPosition(
  triggerRect: DOMRect,
  menuWidth: number,
  menuHeight: number,
  padding = 12,
): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;

  let x = triggerRect.left + triggerRect.width / 2 - menuWidth / 2;
  let y = triggerRect.bottom + 6;

  if (x < padding) {
    x = padding;
  } else if (x + menuWidth > vw - padding) {
    x = vw - menuWidth - padding;
  }

  if (y + menuHeight > vh - padding) {
    y = triggerRect.top - menuHeight - 6;
  }
  if (y < padding) {
    y = padding;
  }

  return { x, y };
}
