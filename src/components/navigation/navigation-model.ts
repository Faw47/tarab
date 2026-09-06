export type NavView =
  | 'home'
  | 'library'
  | 'search'
  | 'queue'
  | 'playlists'
  | 'tags'
  | 'settings'
  | 'album';

export const TOP_BAR_PRIMARY_VIEWS = [
  { view: 'home', label: 'Home' },
  { view: 'library', label: 'Library' },
  { view: 'queue', label: 'Queue' },
  { view: 'playlists', label: 'Playlists' },
] as const satisfies ReadonlyArray<{ view: NavView; label: string }>;

export const TOP_BAR_SECONDARY_VIEWS = [
  { view: 'tags', label: 'Tags' },
  { view: 'settings', label: 'Settings' },
] as const satisfies ReadonlyArray<{ view: NavView; label: string }>;

export const DOCK_NAVIGATION_VIEWS = [
  'home',
  'library',
  'queue',
  'playlists',
  'tags',
  'settings',
] as const satisfies ReadonlyArray<NavView>;

const NAVIGATION_LABELS = new Map<string, string>([
  ...TOP_BAR_PRIMARY_VIEWS.map((item) => [item.view, item.label] as const),
  ...TOP_BAR_SECONDARY_VIEWS.map((item) => [item.view, item.label] as const),
  ['search', 'Search'],
]);

export function getNavigationLabel(view: string): string | null {
  return NAVIGATION_LABELS.get(view) ?? null;
}

/**
 * Search and album details are Library surfaces, so the Library destination
 * remains visibly selected while those modes are open.
 */
export function normalizeDockActiveView(activeView: NavView): NavView {
  return activeView === 'search' || activeView === 'album' ? 'library' : activeView;
}
