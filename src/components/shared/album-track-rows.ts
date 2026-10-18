import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useState } from 'react';

/**
 * Moves focus between the rows of an album tracklist grid with the arrow,
 * Home and End keys. Returns true when it handled the key.
 */
export function moveTrackRowFocus(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const row = event.currentTarget;
  const group = row.parentElement;
  if (!group) return false;
  const rows = Array.from(group.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.getAttribute('role') === 'row',
  );
  const index = rows.indexOf(row);
  if (index < 0) return false;

  let next: HTMLElement | undefined;
  if (event.key === 'ArrowDown') next = rows[index + 1];
  else if (event.key === 'ArrowUp') next = rows[index - 1];
  else if (event.key === 'Home') next = rows[0];
  else if (event.key === 'End') next = rows[rows.length - 1];
  else return false;

  event.preventDefault();
  next?.focus();
  return true;
}

/**
 * Roving tab stop for a tracklist grid: one row is in the tab order (the last focused one, else the
 * first), so Tab moves past the list instead of through every row.
 */
export function useTrackRowTabStop(trackIds: readonly string[]) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const tabStopId = focusedId && trackIds.includes(focusedId) ? focusedId : (trackIds[0] ?? null);
  const onRowFocus = useCallback((id: string) => setFocusedId(id), []);
  return { tabStopId, onRowFocus };
}
