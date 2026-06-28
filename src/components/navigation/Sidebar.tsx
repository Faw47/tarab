import { Home, type LucideIcon, Search, Settings, Tag } from 'lucide-react';
import {
  type CSSProperties,
  type RefObject,
  memo,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from 'react';
import { LibraryIcon, QueueIcon } from '../ui/Icons';
import type { NavView } from './FloatingDock';
import { useLiquidSegmentedPillVertical, applyVerticalPillDom } from '@/hooks/use-liquid-segmented-pill';
import { cn } from '@/lib/utils';

type NavMode = 'iconRail' | 'topNav';

type SidebarNavSegment = 'default' | 'search' | 'libraryBrowse';

interface SidebarProps {
  navMode: NavMode;
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  onSearchTrigger?: () => void;
  /** Collapse search chrome in icon-rail mode (browse library without top search bar). */
  onBrowseLibrary?: () => void;
  /** Search field visible or has query (liquid icon rail); drives Search vs Library highlight. */
  searchUiOpen?: boolean;
  theme?: string;
}

interface SidebarNavItem {
  view: NavView;
  label: string;
  icon: LucideIcon;
  segment?: SidebarNavSegment;
}

interface SidebarNavButtonProps {
  view: NavView;
  currentView: NavView;
  label: string;
  icon: LucideIcon;
  onNavigate: (view: NavView) => void;
  segment?: SidebarNavSegment;
  searchUiOpen?: boolean;
  previewActive?: boolean;
  /** When liquid pill handles pointer-up, ignore the synthetic click (see SlidingTabGroup). */
  suppressNextTabClickRef?: RefObject<boolean>;
  theme?: string;
}

const PRIMARY_NAV_ITEMS: SidebarNavItem[] = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'library', label: 'Search', icon: Search, segment: 'search' },
  { view: 'library', label: 'Library', icon: LibraryIcon as LucideIcon, segment: 'libraryBrowse' },
  { view: 'queue', label: 'Queue', icon: QueueIcon as LucideIcon },
];

const UTILITY_NAV_ITEMS: SidebarNavItem[] = [{ view: 'tags', label: 'Tags', icon: Tag }];

const FOOTER_NAV_ITEMS: SidebarNavItem[] = [
  { view: 'settings', label: 'Settings', icon: Settings },
];

const getIconNavButtonVars = (active: boolean): CSSProperties =>
  ({
    '--adl-liquid-text': active ? 'var(--hero-accent, #ffffff)' : 'rgba(255,255,255,0.76)',
  }) as CSSProperties;

const RailDivider = memo(function RailDivider({
  className,
  theme,
}: {
  className?: string;
  theme?: string;
}) {
  const isNeobrutalism = theme === 'neobrutalism';
  return (
    <div
      className={cn(
        'RailDivider my-3 w-7',
        isNeobrutalism ? 'bg-black opacity-100 h-[3px]' : 'bg-white/5 h-px',
        className,
      )}
      aria-hidden="true"
    />
  );
});

const SidebarNavButton = memo(function SidebarNavButton({
  view,
  currentView,
  label,
  icon: Icon,
  onNavigate,
  segment = 'default',
  searchUiOpen = false,
  previewActive = false,
  suppressNextTabClickRef,
  theme,
}: SidebarNavButtonProps) {
  const onLibrarySurface = currentView === 'library' || currentView === 'search';
  const active = useMemo(() => {
    if (previewActive) return true;
    if (segment === 'search') return onLibrarySurface && searchUiOpen;
    if (segment === 'libraryBrowse') return onLibrarySurface && !searchUiOpen;
    return currentView === view;
  }, [previewActive, segment, onLibrarySurface, searchUiOpen, currentView, view]);
  const handleClick = useCallback(() => {
    if (suppressNextTabClickRef?.current) {
      suppressNextTabClickRef.current = false;
      return;
    }
    onNavigate(view);
  }, [onNavigate, view, suppressNextTabClickRef]);
  const glassVars = useMemo(() => getIconNavButtonVars(active), [active]);

  if (theme === 'neobrutalism') {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={label}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'group flex items-center justify-center border-2 border-black transition-none focus-visible:outline-none rounded-none text-black hover-neo-wiggle',
          active
            ? 'bg-[#F5C518] p-[6px] shadow-none'
            : 'h-11 w-11 bg-white shadow-[4px_4px_0_0_#000] hover:bg-[#F6F6F6] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none',
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={2.5} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label}
      data-tooltip={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'group relative z-10 flex h-11 w-11 items-center justify-center',
        'rounded-full transition-all duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-inset',
        active ? 'text-white' : 'text-white/50 hover:text-white/90',
      )}
      style={{
        ...glassVars,
        ...(active ? { color: 'var(--hero-accent, #fff)' } : {}),
      }}
    >
      <span
        className={cn(
          'transition-all duration-300',
          active
            ? 'scale-110 drop-shadow-[0_0_12px_rgba(255,255,255,0.2)]'
            : 'group-hover:scale-110 group-active:scale-95',
        )}
      >
        <Icon className={cn('h-6 w-6', active ? 'stroke-[2.5px]' : 'stroke-[2.25px]')} />
      </span>
    </button>
  );
});

const SidebarNavGroup = memo(function SidebarNavGroup({
  items,
  currentView,
  onNavigate,
  onSearchTrigger,
  onBrowseLibrary,
  searchUiOpen = false,
  theme,
}: {
  items: SidebarNavItem[];
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  onSearchTrigger?: () => void;
  onBrowseLibrary?: () => void;
  searchUiOpen?: boolean;
  theme?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const isNeobrutalism = theme === 'neobrutalism';

  const activeIndex = useMemo(() => {
    const idx = items.findIndex((t) => {
      const onLib = currentView === 'library' || currentView === 'search';
      if (t.segment === 'search') return onLib && searchUiOpen;
      if (t.segment === 'libraryBrowse') return onLib && !searchUiOpen;
      return currentView === t.view;
    });
    return idx >= 0 ? idx : 0;
  }, [items, currentView, searchUiOpen]);

  const onCommitIndex = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      if (item.segment === 'search') {
        onSearchTrigger?.();
      }
      if (item.segment === 'libraryBrowse') {
        onBrowseLibrary?.();
      }
      onNavigate(item.view);
    },
    [items, onBrowseLibrary, onNavigate, onSearchTrigger],
  );

  const {
    pillStyle,
    isDragging,
    pillLayoutFromDom,
    dragPreviewIndex,
    pillGeometryRef,
    suppressNextTabClickRef,
    listProps,
  } = useLiquidSegmentedPillVertical({
    rootRef: navRef,
    pillElementRef: pillRef,
    tabSelector: 'button',
    activeIndex: activeIndex >= 0 ? activeIndex : 0,
    onCommitIndex,
    syncDependencies: [currentView, items, searchUiOpen],
    enabled: !isNeobrutalism,
  });

  useLayoutEffect(() => {
    if (!pillLayoutFromDom) return;
    const el = pillRef.current;
    const g = pillGeometryRef.current;
    if (el && g) applyVerticalPillDom(el, g.top, g.height);
  }, [pillLayoutFromDom, dragPreviewIndex, isDragging, pillGeometryRef]);

  return (
    <nav
      ref={navRef}
      className={cn(
        'relative flex flex-col items-center',
        isNeobrutalism ? 'gap-2' : 'gap-1',
      )}
      {...listProps}
    >
      {!isNeobrutalism && (
        <div
          ref={pillRef}
          className={cn(
            'absolute left-1/2 -translate-x-1/2 w-11 h-11 rounded-full pointer-events-none motion-reduce:transition-none',
            isDragging || pillLayoutFromDom
              ? 'transition-none'
              : 'transition-[top,height,opacity] duration-200 ease-out',
          )}
          style={{
            ...(pillLayoutFromDom
              ? {}
              : { top: pillStyle.top, height: pillStyle.height, opacity: pillStyle.opacity }),
            background: [
              'linear-gradient(180deg,',
              `  color-mix(in oklch, var(--surface-tint, rgba(255,255,255,0.12)) 60%, rgba(255,255,255,0.18)) 0%,`,
              `  color-mix(in oklch, var(--surface-tint, rgba(255,255,255,0.12)) 30%, rgba(255,255,255,0.08)) 100%`,
              ')',
            ].join(''),
            boxShadow: [
              'inset 0 1px 0 rgba(255,255,255,0.14)',
              'inset 0 -1px 0 rgba(0,0,0,0.06)',
            ].join(', '),
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-3 top-0 h-px rounded-full"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
              opacity: 0.7,
            }}
          />
        </div>
      )}

      {items.map((item, idx) => (
        <SidebarNavButton
          key={`${item.view}-${item.label}`}
          view={item.view}
          currentView={currentView}
          label={item.label}
          icon={item.icon}
          segment={item.segment}
          searchUiOpen={searchUiOpen}
          previewActive={dragPreviewIndex !== null && idx === dragPreviewIndex}
          suppressNextTabClickRef={isNeobrutalism ? undefined : suppressNextTabClickRef}
          onNavigate={(view) => {
            if (item.segment === 'search') {
              onSearchTrigger?.();
            }
            if (item.segment === 'libraryBrowse') {
              onBrowseLibrary?.();
            }
            onNavigate(view);
          }}
          theme={theme}
        />
      ))}
    </nav>
  );
});

export const Sidebar = memo(function Sidebar({
  navMode,
  currentView,
  onNavigate,
  onSearchTrigger,
  onBrowseLibrary,
  searchUiOpen = false,
  theme,
}: SidebarProps) {
  if (navMode !== 'iconRail') return null;

  return (
    <aside
      className={cn(
        /* Liquid: stay fully transparent so shell/WebGL reads as one surface (no second blur stack). */
        'relative hidden w-18 shrink-0 flex-col bg-transparent lg:flex',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            'flex flex-col items-center gap-2 p-1.5',
            typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform) && 'pt-12',
          )}
        >
          <div className="flex flex-col items-center py-2 px-1">
            <SidebarNavGroup
              items={PRIMARY_NAV_ITEMS}
              currentView={currentView}
              onNavigate={onNavigate}
              onSearchTrigger={onSearchTrigger}
              onBrowseLibrary={onBrowseLibrary}
              searchUiOpen={searchUiOpen}
              theme={theme}
            />

            <RailDivider theme={theme} className="w-6 opacity-20" />

            <SidebarNavGroup
              items={UTILITY_NAV_ITEMS}
              currentView={currentView}
              onNavigate={onNavigate}
              onSearchTrigger={onSearchTrigger}
              onBrowseLibrary={onBrowseLibrary}
              searchUiOpen={searchUiOpen}
              theme={theme}
            />
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-center pb-5 px-1.5">
          <div className="flex flex-col items-center p-1">
            <SidebarNavGroup
              items={FOOTER_NAV_ITEMS}
              currentView={currentView}
              onNavigate={onNavigate}
              onSearchTrigger={onSearchTrigger}
              onBrowseLibrary={onBrowseLibrary}
              searchUiOpen={searchUiOpen}
              theme={theme}
            />
          </div>
        </div>
      </div>
    </aside>
  );
});
