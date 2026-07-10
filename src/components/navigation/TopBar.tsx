import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  Home,
  Loader2,
  type LucideIcon,
  Search,
  Settings,
  Shuffle,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  forwardRef,
  memo,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { LibraryIcon, QueueIcon, TagIcon } from '../ui/Icons';
import type { NavView } from './FloatingDock';
import { SlidingTabGroup } from './SlidingTabGroup';
import { useTopBarSearchShortcuts } from './useTopBarSearchShortcuts';
import { WindowsWindowControls } from './WindowsWindowControls';

/* ─── CONSTANTS ──────────────────────────────────────────────────────────── */

const SEARCH_INPUT_ID = 'global-library-search';

const PRIMARY_TABS: Array<{ view: NavView; label: string; icon: LucideIcon }> = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'library', label: 'Library', icon: LibraryIcon as LucideIcon },
  { view: 'queue', label: 'Queue', icon: QueueIcon as LucideIcon },
];

const SECONDARY_TABS: Array<{ view: NavView; label: string; icon: LucideIcon }> = [
  { view: 'tags', label: 'Tags', icon: TagIcon as LucideIcon },
  { view: 'settings', label: 'Settings', icon: Settings },
];

/* ─── TYPES ──────────────────────────────────────────────────────────────── */

export interface ProcessingTask {
  label: string;
  progress?: number;
}

interface TopBarProps {
  navMode: 'iconRail' | 'topNav';
  currentView: string;
  onNavigate: (view: NavView) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isScanning: boolean;
  scanProgress: number;
  activeProcessing?: ProcessingTask;
  titlebarInsetLeft?: number;
  onShuffleAll?: () => void;
  isSearching?: boolean;
  isScrolled?: boolean;
  heroAccent?: string;
  /** Fired when the global search field gains or loses focus (for shell effects). */
  onSearchFocusChange?: (focused: boolean) => void;
  /** Increment (e.g. sidebar Search) to focus the field even when the bar is already mounted. */
  focusSearchNonce?: number;
  /** Normalized pointer (0–1) within the header; drives app-shell WebGL when provided. */
  headerPointerRef?: RefObject<{ x: number; y: number } | null>;
  /** When true (default), shell ambient extends under the bar — light veil only. Set false for a heavier frosted bar. */
  sharesHomeAmbient?: boolean;
  hideBorder?: boolean;
  isTransparent?: boolean;
  onBack?: () => void;
  canGoBack?: boolean;
  className?: string;
}

interface PlatformShortcuts {
  shortcutLabel: string;
  ariaShortcut: string;
}

interface StatusData {
  label: string;
  shortLabel: string;
  progressText: string | null;
  progressValue: number | null;
}

interface SearchBarProps {
  value: string;
  onChange: (query: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onClear: () => void;
  onEscape: () => void;
  isSearching: boolean;
  shortcutLabel: string;
  ariaShortcut: string;
  compact?: boolean;
}

interface ActionIconButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  isActive?: boolean;
}

interface ActionNavIconProps {
  view: NavView;
  label: string;
  icon: LucideIcon;
  currentView: string;
  onNavigate: (view: NavView) => void;
}

interface StatusIndicatorProps {
  status: StatusData | null;
  compact?: boolean;
}

/* ─── HELPERS ────────────────────────────────────────────────────────────── */

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** macOS WebKit: keep clicks on controls; only sibling drag strips move the window */
const chromeNoDragStyle = {
  WebkitAppRegion: 'no-drag',
  appRegion: 'no-drag',
} as CSSProperties;

const titleDragStyle = {
  WebkitAppRegion: 'drag',
  appRegion: 'drag',
} as CSSProperties;

/* ─── HOOKS ──────────────────────────────────────────────────────────────── */

const usePlatformShortcuts = (): PlatformShortcuts => {
  const cached = useRef<PlatformShortcuts | null>(null);

  if (cached.current === null) {
    cached.current = {
      shortcutLabel: '/',
      ariaShortcut: 'Slash',
    };
  }

  return cached.current;
};

/* ─── SHARED BASE GLASS BUTTON ───────────────────────────────────────────── */

interface BaseGlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  isIconOnly?: boolean;
}

const BaseGlassButton = forwardRef<HTMLButtonElement, BaseGlassButtonProps>(
  ({ isActive, isIconOnly, className, children, ...props }, ref) => {
    const activeBgBase = `var(--surface-tint, rgba(255, 255, 255, 0.08))`;

    return (
      <button
        ref={ref}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'group relative flex shrink-0 items-center justify-center gap-1.5 rounded-full',
          'transition-all duration-300 motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
          isIconOnly ? 'h-8 w-8' : 'h-8 px-3.5',
          isActive ? 'text-white' : 'text-white/50 hover:text-white/90 hover:bg-white/[0.04]',
          className,
        )}
        style={
          isActive
            ? {
                background: [
                  'linear-gradient(180deg,',
                  `  color-mix(in oklch, ${activeBgBase} 60%, rgba(255,255,255,0.13)) 0%,`,
                  `  color-mix(in oklch, ${activeBgBase} 30%, rgba(255,255,255,0.06)) 50%,`,
                  `  color-mix(in oklch, ${activeBgBase} 10%, rgba(255,255,255,0.04)) 100%`,
                  ')',
                ].join(''),
                boxShadow: [
                  'inset 0 1px 0 rgba(255,255,255,0.18)',
                  'inset 0 -1px 0 rgba(0,0,0,0.08)',
                  `0 0 14px -6px rgb(var(--hero-accent-rgb, 255 255 255) / 0.40)`,
                  '0 2px 8px -4px rgba(0,0,0,0.25)',
                ].join(', '),
                color: 'var(--hero-accent, #fff)',
              }
            : {
                background: 'transparent',
                boxShadow: 'none',
              }
        }
        {...props}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-2 top-0 h-px rounded-full"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
              opacity: 0.7,
            }}
          />
        )}
        {children}
      </button>
    );
  },
);
BaseGlassButton.displayName = 'BaseGlassButton';

/* ─── BUTTON IMPLEMENTATIONS ─────────────────────────────────────────────── */

const ActionIconButton = memo(function ActionIconButton({
  label,
  icon,
  onClick,
  isActive = false,
}: ActionIconButtonProps) {
  return (
    <BaseGlassButton
      isActive={isActive}
      onClick={onClick}
      isIconOnly
      title={label}
      aria-label={label}
    >
      {icon}
    </BaseGlassButton>
  );
});
ActionIconButton.displayName = 'ActionIconButton';

const ActionNavIcon = memo(function ActionNavIcon({
  view,
  label,
  icon: Icon,
  currentView,
  onNavigate,
}: ActionNavIconProps) {
  return (
    <ActionIconButton
      label={label}
      icon={<Icon className="h-4 w-4" />}
      onClick={() => onNavigate(view)}
      isActive={currentView === view}
    />
  );
});
ActionNavIcon.displayName = 'ActionNavIcon';

/* ─── SEARCH BAR ─────────────────────────────────────────────────────────── */

const SearchBarBase = forwardRef<HTMLInputElement, SearchBarProps>(
  (
    {
      value,
      onChange,
      onFocus,
      onBlur,
      onClear,
      onEscape,
      isSearching,
      shortcutLabel,
      ariaShortcut,
      compact = false,
    },
    ref,
  ) => {
    return (
      <div
        className={cn(
          'group relative flex w-full items-center gap-3 overflow-hidden px-4 transition-all duration-500',
          'rounded-full border border-white/[0.04] bg-white/[0.03] backdrop-blur-none',
          'focus-within:border-white/[0.12] focus-within:bg-white/[0.07] focus-within:shadow-[0_0_24px_-4px_rgba(0,0,0,0.3)]',
          compact ? 'h-9' : 'h-10 md:h-11',
        )}
        style={{
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.02), 0 2px 12px -4px rgba(0,0,0,0.5)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-focus-within:opacity-100"
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[rgb(var(--hero-accent-rgb,255_255_255)/0.08)] to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[rgb(var(--hero-accent-rgb,255_255_255)/0.6)] to-transparent" />
        </div>

        <div className="relative z-10 flex w-5 shrink-0 items-center justify-center">
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--hero-accent)]" />
          ) : (
            <Search className="h-4 w-4 text-white/40 transition-colors duration-300 group-focus-within:text-[var(--hero-accent)]" />
          )}
        </div>

        <input
          ref={ref}
          id={SEARCH_INPUT_ID}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onEscape();
            }
          }}
          placeholder="Search your library..."
          aria-label="Search library"
          aria-keyshortcuts={ariaShortcut}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className="relative z-10 h-full min-w-0 flex-1 bg-transparent text-[14px] font-medium text-white outline-none placeholder:text-white/30"
          style={{ caretColor: 'var(--hero-accent, white)' }}
        />

        {value ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            aria-label="Clear search"
            className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition-all duration-200 hover:bg-white/20 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        ) : (
          <kbd
            aria-hidden="true"
            className={cn(
              'relative z-10 hidden h-5 items-center rounded bg-white/[0.08] px-1.5 text-[10px] font-medium text-white/40 ring-1 ring-inset ring-white/[0.05]',
              'transition-opacity duration-300 group-focus-within:opacity-0',
              compact ? 'sm:hidden' : 'md:flex',
            )}
          >
            {shortcutLabel}
          </kbd>
        )}
      </div>
    );
  },
);
SearchBarBase.displayName = 'SearchBar';
const SearchBar = memo(SearchBarBase);

/* ─── STATUS INDICATOR ───────────────────────────────────────────────────── */

const StatusIndicator = memo(function StatusIndicator({
  status,
  compact = false,
}: StatusIndicatorProps) {
  const prevStatus = useRef<StatusData | null>(status);

  useEffect(() => {
    if (status) prevStatus.current = status;
  }, [status]);

  const display = status ?? prevStatus.current;

  return (
    <>
      {status && (
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {display?.label}
          {display?.progressText ? `, ${display.progressText}` : ''}
        </span>
      )}

      <div
        aria-hidden={status ? 'false' : 'true'}
        className={cn(
          'relative overflow-hidden rounded-full border border-white/[0.06] bg-black/40 backdrop-blur-none transition-all duration-300 motion-reduce:transition-none',
          'h-8',
          status
            ? cn(compact ? 'max-w-[88px] px-2.5' : 'max-w-[186px] px-3', 'opacity-100')
            : 'max-w-0 border-transparent px-0 opacity-0',
        )}
        style={
          status
            ? {
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.03), 0 8px 18px -16px rgb(var(--hero-accent-rgb,255 255 255) / 0.35)',
              }
            : undefined
        }
      >
        {display && (
          <div className="flex h-full items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--hero-accent,white)]" />

            {compact ? (
              <span className="truncate text-[11px] font-semibold text-white/60">
                {display.shortLabel}
              </span>
            ) : (
              <span
                className="truncate text-[12px] font-medium text-white/70"
                title={display.label}
              >
                {display.label}
              </span>
            )}

            {display.progressText && (
              <span className="shrink-0 text-[11px] font-bold text-[var(--hero-accent,white)]">
                {display.progressText}
              </span>
            )}
          </div>
        )}

        {display?.progressValue != null && (
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/[0.04]">
            <div
              className="h-full bg-[var(--hero-accent)] transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${display.progressValue}%` }}
            />
          </div>
        )}
      </div>
    </>
  );
});
StatusIndicator.displayName = 'StatusIndicator';

/* ─── TOP BAR ────────────────────────────────────────────────────────────── */

export const TopBar = memo(function TopBar({
  navMode,
  currentView,
  onNavigate,
  searchQuery,
  onSearchChange,
  isScanning,
  scanProgress,
  activeProcessing,
  titlebarInsetLeft = 0,
  onShuffleAll,
  isSearching = false,
  isScrolled = false,
  heroAccent,
  onSearchFocusChange,
  focusSearchNonce = 0,
  headerPointerRef,
  sharesHomeAmbient = true,
  hideBorder,
  isTransparent,
  onBack,
  canGoBack = false,
  className,
}: TopBarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const fallbackPointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerNormRef = headerPointerRef ?? fallbackPointerRef;
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const { shortcutLabel, ariaShortcut } = usePlatformShortcuts();

  const handleHeaderPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const el = headerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.max(r.width, 1);
    const h = Math.max(r.height, 1);
    pointerNormRef.current = {
      x: clamp((e.clientX - r.left) / w, 0, 1),
      y: clamp((e.clientY - r.top) / h, 0, 1),
    };
  }, []);

  const handleHeaderPointerLeave = useCallback(() => {
    pointerNormRef.current = null;
  }, []);

  const isSearchSurface = currentView === 'library' || currentView === 'search';
  const isWindowsDesktop = /Win/i.test(navigator.platform);

  const focusSearchInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }, []);

  useLayoutEffect(() => {
    if (!focusSearchNonce) return;
    focusSearchInput();
  }, [focusSearchNonce, focusSearchInput]);

  const handleSearchShortcutFocus = useCallback(() => {
    setIsSearchFocused(true);
    onSearchFocusChange?.(true);
    focusSearchInput();
  }, [focusSearchInput, onSearchFocusChange]);

  // Auto-focus search on mount if in a search surface
  useEffect(() => {
    if (isSearchSurface && !searchQuery) {
      focusSearchInput();
    }
  }, [isSearchSurface, focusSearchInput, searchQuery]);

  const handleClearSearch = useCallback(() => {
    onSearchChange('');
  }, [onSearchChange]);

  useTopBarSearchShortcuts({
    inputId: SEARCH_INPUT_ID,
    inputRef: searchInputRef,
    onFocusSearch: handleSearchShortcutFocus,
    onClearSearch: handleClearSearch,
  });

  const handleSearchChange = useCallback(
    (query: string) => {
      onSearchChange(query);
      if (query.trim() && !isSearchSurface) {
        onNavigate('library');
      }
    },
    [isSearchSurface, onNavigate, onSearchChange],
  );

  const handleSearchFocus = useCallback(() => {
    setIsSearchFocused(true);
    onSearchFocusChange?.(true);
  }, [onSearchFocusChange]);

  const handleSearchBlur = useCallback(() => {
    setIsSearchFocused(false);
    onSearchFocusChange?.(false);
  }, [onSearchFocusChange]);

  const handleSearchEscape = useCallback(() => {
    if (searchQuery) {
      onSearchChange('');
      searchInputRef.current?.focus();
      return;
    }
    searchInputRef.current?.blur();
  }, [onSearchChange, searchQuery]);

  const handleClearAndRefocus = useCallback(() => {
    onSearchChange('');
    searchInputRef.current?.focus();
  }, [onSearchChange]);

  const status = useMemo<StatusData | null>(() => {
    if (isScanning) {
      const progressValue = scanProgress > 0 ? clamp(Math.round(scanProgress), 0, 100) : null;
      return {
        label: activeProcessing?.label ?? 'Scanning library',
        shortLabel: 'Scanning',
        progressText: progressValue != null ? `${progressValue}%` : null,
        progressValue,
      };
    }

    if (activeProcessing) {
      const progressValue =
        typeof activeProcessing.progress === 'number'
          ? clamp(Math.round(activeProcessing.progress), 0, 100)
          : null;
      return {
        label: activeProcessing.label,
        shortLabel: 'Working',
        progressText: progressValue != null ? `${progressValue}%` : null,
        progressValue,
      };
    }

    return null;
  }, [activeProcessing, isScanning, scanProgress]);

  const showShuffle =
    onShuffleAll != null && (currentView === 'library' || currentView === 'search');

  const headerVarStyle = useMemo(() => {
    const style: CSSProperties = {};
    if (heroAccent) {
      (style as Record<string, string>)['--hero-accent'] = heroAccent;
    }
    return style;
  }, [heroAccent]);

  const gradientOverlayStyle = useMemo(() => {
    const style: CSSProperties = {};
    if (sharesHomeAmbient) {
      const bottomVeil = isScrolled ? 0.18 : 0.11;
      style.backgroundImage = [
        `linear-gradient(180deg, rgba(13,11,9,0.02) 0%, rgba(13,11,9,${bottomVeil}) 100%)`,
        'linear-gradient(180deg, rgb(var(--hero-accent-rgb, 255 255 255) / 0.06) 0%, transparent 58%)',
      ].join(', ');
      return style;
    }

    // Unified dark glass shell background
    style.backgroundColor = 'rgba(13, 11, 9, 0.48)';
    return style;
  }, [sharesHomeAmbient, isScrolled]);

  return (
    <header
      ref={headerRef}
      data-app-top-bar
      style={headerVarStyle}
      onPointerMove={handleHeaderPointerMove}
      onPointerLeave={handleHeaderPointerLeave}
      className={cn(
        'relative isolate z-50 h-14 shrink-0 overflow-hidden transition-all duration-500',
        !hideBorder && navMode !== 'iconRail' && 'border-b border-white/[0.04]',
        isScrolled && 'shadow-none',
        isTransparent && !isScrolled && 'border-transparent bg-transparent shadow-none',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 z-[1]',
          !sharesHomeAmbient && 'backdrop-blur-[32px] backdrop-saturate-[180%]',
          isTransparent && !isScrolled && 'opacity-0',
        )}
        style={gradientOverlayStyle}
      />

      {/* Desktop: Spotify-style unified bar — flex with spacers keeps the search optically centered; drag strips flank it. */}
      <div
        className={cn(
          'relative z-10 hidden h-full w-full min-w-0 items-center justify-between px-4 md:flex',
          navMode === 'iconRail' && /Mac|iPhone|iPad|iPod/.test(navigator.platform) && 'pl-4', // traffic light clearing
        )}
      >
        <div
          data-tauri-drag-region
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-2"
          style={titleDragStyle}
        />

        {/* Left Section: Back Button + Navigation Tabs (flex-1) */}
        <div
          className="flex h-full flex-1 items-center justify-start gap-2.5"
          style={{
            ...chromeNoDragStyle,
            paddingLeft: titlebarInsetLeft > 0 ? titlebarInsetLeft : undefined,
          }}
        >
          <AnimatePresence mode="popLayout">
            {canGoBack && (
              <motion.div
                key="back-button"
                initial={{ opacity: 0, x: -10, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -10, scale: 0.9 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                className="flex items-center"
              >
                <Button
                  onClick={onBack}
                  className="h-10 w-10 rounded-full shadow-md bg-black/20"
                  contentClassName="flex items-center justify-center p-0"
                  aria-label="Go back"
                  title="Back"
                  reducedEffects={false}
                >
                  <ChevronLeft className="h-5 w-5 -translate-x-[0.5px]" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {navMode === 'topNav' && (
            <SlidingTabGroup
              tabs={PRIMARY_TABS}
              currentView={currentView}
              onNavigate={onNavigate}
            />
          )}
        </div>

        <div
          data-tauri-drag-region
          aria-hidden="true"
          className="h-full w-4 shrink-0"
          style={titleDragStyle}
        />

        {/* Center Section: Search Pill (flex-none) */}
        <div
          className="flex-none flex items-center justify-center w-full max-w-[min(100%,420px)] lg:max-w-[min(100%,520px)] px-2"
          style={chromeNoDragStyle}
        >
          <div
            className={cn(
              'w-full transition-all duration-500 ease-out motion-reduce:transition-none',
              isSearchFocused ? 'scale-[1.01]' : 'scale-100',
            )}
          >
            <SearchBar
              ref={searchInputRef}
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={handleSearchFocus}
              onBlur={handleSearchBlur}
              onClear={handleClearAndRefocus}
              onEscape={handleSearchEscape}
              isSearching={isSearching}
              shortcutLabel={shortcutLabel}
              ariaShortcut={ariaShortcut}
            />
          </div>
        </div>

        {/* Right Section: Status Indicator + Secondary Tabs (flex-1) */}
        <div
          className="flex h-full flex-1 items-center justify-end gap-3"
          style={chromeNoDragStyle}
        >
          <StatusIndicator status={status} />

          {showShuffle && onShuffleAll && (
            <ActionIconButton
              label="Shuffle all"
              icon={<Shuffle className="h-4 w-4" />}
              onClick={onShuffleAll}
            />
          )}

          {navMode === 'topNav' && (
            <div className="ml-1 flex items-center gap-1 border-l border-white/[0.05] pl-2">
              {SECONDARY_TABS.map((item) => (
                <ActionNavIcon
                  key={item.view}
                  view={item.view}
                  label={item.label}
                  icon={item.icon}
                  currentView={currentView}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </div>

        <div
          data-tauri-drag-region
          aria-hidden="true"
          className="h-full w-4 shrink-0"
          style={titleDragStyle}
        />

        {isWindowsDesktop && (
          <div className="flex h-full items-stretch">
            <WindowsWindowControls className="h-full" />
          </div>
        )}
      </div>

      {/* Mobile layout */}
      <div className="relative z-10 flex h-full min-w-0 items-stretch gap-2 px-2 md:hidden">
        <div
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto"
          style={chromeNoDragStyle}
        >
          {PRIMARY_TABS.map((item) => (
            <ActionNavIcon
              key={item.view}
              view={item.view}
              label={item.label}
              icon={item.icon}
              currentView={currentView}
              onNavigate={onNavigate}
            />
          ))}
        </div>

        <div
          data-tauri-drag-region
          className="min-w-[8px] flex-1"
          aria-hidden="true"
          style={titleDragStyle}
        />

        <div className="flex min-w-0 flex-[2] items-center" style={chromeNoDragStyle}>
          <SearchBar
            ref={searchInputRef}
            value={searchQuery}
            onChange={handleSearchChange}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            onClear={handleClearAndRefocus}
            onEscape={handleSearchEscape}
            isSearching={isSearching}
            shortcutLabel={shortcutLabel}
            ariaShortcut={ariaShortcut}
            compact
          />
        </div>

        <div
          data-tauri-drag-region
          className="hidden min-w-[8px] flex-1 sm:block"
          aria-hidden="true"
          style={titleDragStyle}
        />

        <div className="flex shrink-0 items-center gap-1" style={chromeNoDragStyle}>
          <StatusIndicator status={status} compact />
          {showShuffle && onShuffleAll && (
            <ActionIconButton
              label="Shuffle all"
              icon={<Shuffle className="h-4 w-4" />}
              onClick={onShuffleAll}
            />
          )}
        </div>
      </div>
    </header>
  );
});

TopBar.displayName = 'memo(TopBar)';
