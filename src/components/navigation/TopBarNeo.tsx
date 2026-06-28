import {
  Home,
  Library,
  Loader2,
  ListMusic,
  type LucideIcon,
  Search,
  Settings,
  Shuffle,
  Tag,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { cn } from '@/lib/utils';
import type { NavView } from './FloatingDock';
import { WindowsWindowControls } from './WindowsWindowControls';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessingTask {
  label: string;
  progress?: number;
}

interface TopBarNeoProps {
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
  focusSearchNonce?: number;
  // NOTE: Secondary tabs (Tags, Settings) are intentionally absent in
  // iconRail mode — FloatingDock owns them in that layout. This is a
  // deliberate design contract, not an oversight.
}

interface StatusData {
  label: string;
  progressText: string | null;
  progressValue: number | null;
}

// ---------------------------------------------------------------------------
// Module-level constants
//
// Platform detection runs once at module load. The platform never changes
// mid-session, so computing this inside a hook (with a ref cache) is
// unnecessary overhead.
// ---------------------------------------------------------------------------

const SEARCH_INPUT_ID = 'global-library-search-neo';

const PLATFORM_SHORTCUT = {
  shortcutLabel: '/',
  ariaShortcut: 'Slash',
} as const;

const PRIMARY_TABS: Array<{ view: NavView; label: string; icon: LucideIcon }> = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'library', label: 'Library', icon: Library },
  { view: 'queue', label: 'Queue', icon: ListMusic },
];

const SECONDARY_TABS: Array<{ view: NavView; label: string; icon: LucideIcon }> = [
  { view: 'tags', label: 'Tags', icon: Tag },
  { view: 'settings', label: 'Settings', icon: Settings },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('input, textarea, select, [contenteditable]') !== null;
};

const chromeNoDragStyle = {
  WebkitAppRegion: 'no-drag',
  appRegion: 'no-drag',
} as CSSProperties;

const titleDragStyle = {
  WebkitAppRegion: 'drag',
  appRegion: 'drag',
} as CSSProperties;

// ---------------------------------------------------------------------------
// Button style helpers
//
// Shadow scale (two-tier):
//   Primary nav buttons: 4px offset
//   Secondary (Tags/Settings/Shuffle/Clear/kbd): 2px offset
//
// TopBarNeo palette (this bar only):
//   Header shell:             #E6E6E6
//   Primary nav idle:         #FFFFFF  | hover: #A4B680 (sage)
//   Search field:             #FFFFFF at rest | focus-within: #A091D0 (lavender)
//   Secondary actions idle:   #F6F6F6  | hover: #E4C463 (mustard)
//   Active / pressed:         #000000 bg, #FFFFFF text
// ---------------------------------------------------------------------------

const BUTTON_BASE_CLASS =
  'inline-flex items-center justify-center gap-3 border-2 border-black font-black uppercase tracking-[0.15em] transition-none focus-visible:outline-none rounded-none cursor-pointer';

// Primary nav buttons — 4px hard shadow
// Active state: background: #F5C518, border: 2px solid #000000, padding: 6px equivalent
const primaryButtonStateClass = (active: boolean) =>
  active
    ? 'bg-transparent text-black border-2 border-black shadow-none'
    : 'bg-white text-black shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:bg-[#A4B680]';

// Secondary action buttons — 2px hard shadow
const secondaryButtonStateClass = (active: boolean) =>
  active
    ? 'bg-black text-white translate-x-[2px] translate-y-[2px] shadow-none'
    : 'bg-[#F6F6F6] text-black shadow-[4px_4px_0_0_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none hover:bg-[#E4C463]';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const NeoNavButton = memo(function NeoNavButton({
  view,
  label,
  icon: Icon,
  isActive,
  onNavigate,
}: {
  view: NavView;
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onNavigate: (view: NavView) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(view)}
      aria-current={isActive ? 'page' : undefined}
      className={cn(BUTTON_BASE_CLASS, primaryButtonStateClass(isActive), 'h-10 px-0 pr-5 text-[12px] overflow-hidden hover-neo-wiggle')}
    >
      <div className={cn(
        'flex h-full aspect-square items-center justify-center border-r-2 border-inherit transition-none',
        isActive ? 'bg-[#F5C518]' : 'bg-transparent'
      )}>
        <Icon className="h-4 w-4 shrink-0" strokeWidth={3} />
      </div>
      <span className="ml-[6px]">{label}</span>
    </button>
  );
});

NeoNavButton.displayName = 'NeoNavButton';

const NeoSecondaryAction = memo(function NeoSecondaryAction({
  label,
  icon,
  onClick,
  active = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(BUTTON_BASE_CLASS, secondaryButtonStateClass(active), 'h-10 px-4 text-[12px] hover-neo-wiggle')}
    >
      {icon}
      <span className="hidden lg:inline-block">{label}</span>
    </button>
  );
});

NeoSecondaryAction.displayName = 'NeoSecondaryAction';

const ProcessingStatus = memo(function ProcessingStatus({ status }: { status: StatusData }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="relative flex h-10 min-w-[180px] max-w-[240px] items-center gap-3 overflow-hidden border-2 border-black bg-white px-3 shadow-[4px_4px_0_0_#000]"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-black" strokeWidth={3} aria-hidden />
      <span className="truncate text-[12px] font-black uppercase tracking-[0.1em] text-black">
        {status.label}
      </span>
      {status.progressText && (
        <span className="ml-auto shrink-0 text-[12px] font-black text-black">
          {status.progressText}
        </span>
      )}
      {status.progressValue != null && (
        <div className="absolute inset-x-0 bottom-0 h-[8px] border-t-2 border-black bg-white">
          <div
            className="h-full border-r-2 border-black bg-[#DAB852]"
            style={{ width: `${status.progressValue}%` }}
          />
        </div>
      )}
    </div>
  );
});


ProcessingStatus.displayName = 'ProcessingStatus';

// ---------------------------------------------------------------------------
// TopBarNeo
// ---------------------------------------------------------------------------

export const TopBarNeo = memo(function TopBarNeo({
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
  focusSearchNonce = 0,
}: TopBarNeoProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  const status = useMemo<StatusData | null>(() => {
    if (isScanning) {
      const progressValue = scanProgress > 0 ? clamp(Math.round(scanProgress), 0, 100) : null;
      return {
        label: activeProcessing?.label ?? 'Scanning Library',
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
        progressText: progressValue != null ? `${progressValue}%` : null,
        progressValue,
      };
    }

    return null;
  }, [activeProcessing, isScanning, scanProgress]);

  const showShuffle =
    onShuffleAll != null && (currentView === 'library' || currentView === 'search');

  // currentView is in the dep array directly so the callback never captures a
  // stale isSearchSurface derivation from a previous render.
  const handleSearchChange = useCallback(
    (query: string) => {
      onSearchChange(query);
      const onSearchSurface = currentView === 'library' || currentView === 'search';
      if (query.trim() && !onSearchSurface) {
        onNavigate('library');
      }
    },
    [currentView, onNavigate, onSearchChange],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const isSearchInput = target?.id === SEARCH_INPUT_ID;

      const isSlash =
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === '/';
      const isEscape = event.key === 'Escape';

      if (isSlash) {
        if (isTextEntryTarget(target) && !isSearchInput) return;
        event.preventDefault();
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      }

      if (isEscape && document.activeElement === searchInputRef.current) {
        event.preventDefault();
        if (searchInputRef.current?.value) {
          onSearchChange('');
          searchInputRef.current.focus();
        } else {
          searchInputRef.current?.blur();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSearchChange]);

  return (
    <header
      className="relative z-50 flex h-14 shrink-0 items-center border-b-2 border-black bg-[#E6E6E6] px-4"
    >
      <div
        data-tauri-drag-region
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-0 h-2"
        style={titleDragStyle}
      />

      {/* COMPACT SINGLE ROW: Nav | Search | Status + Secondary Actions */}
      <div className="relative z-10 flex min-w-0 flex-1 items-center gap-3">
        {/* Left: Primary Nav */}
        <div
          className="flex shrink-0 items-center"
          style={{ ...chromeNoDragStyle, paddingLeft: titlebarInsetLeft || undefined }}
        >
          {navMode === 'topNav' ? (
            <nav
              aria-label="Primary sections"
              className="flex items-center gap-2 border-2 border-black bg-white p-1 shadow-[4px_4px_0_0_#000]"
            >
              {PRIMARY_TABS.map((item) => (
                <NeoNavButton
                  key={item.view}
                  view={item.view}
                  label={item.label}
                  icon={item.icon}
                  isActive={currentView === item.view}
                  onNavigate={onNavigate}
                />
              ))}
            </nav>
          ) : (
            <div className="inline-flex h-10 items-center border-2 border-black bg-[#A4B680] px-4 shadow-[4px_4px_0_0_#000]">
              <span className="text-[13px] font-black uppercase tracking-[0.1em] text-black">
                {PRIMARY_TABS.find((item) => item.view === currentView)?.label ?? 'Browse'}
              </span>
            </div>
          )}
        </div>

        <div
          data-tauri-drag-region
          aria-hidden="true"
          className="h-full w-3 shrink-0"
          style={titleDragStyle}
        />

        {/* Center: Search — lavender focus-within; instant state */}
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2" style={chromeNoDragStyle}>
          <div className="flex h-10 w-full items-center gap-3 border-2 border-black bg-white px-4 shadow-[4px_4px_0_0_#000] transition-none focus-within:bg-[#A091D0]">
            <div className="flex shrink-0 items-center justify-center">
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin text-black" strokeWidth={3} aria-hidden />
              ) : (
                <Search className="h-4 w-4 text-black" strokeWidth={3} />
              )}
            </div>

            <input
              ref={searchInputRef}
              id={SEARCH_INPUT_ID}
              type="text"
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="SEARCH..."
              aria-label="Search library"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-black uppercase tracking-[0.05em] text-black placeholder:text-black/30 outline-none"
            />

            {searchQuery ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSearchChange('');
                  searchInputRef.current?.focus();
                }}
                className="inline-flex h-6 w-6 items-center justify-center border-2 border-black bg-[#F6F6F6] text-black shadow-[2px_2px_0_0_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none hover:bg-[#E4C463]"
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            ) : (
              <kbd className="hidden h-6 items-center border-2 border-black bg-[#F6F6F6] px-2 shadow-[2px_2px_0_0_#000] md:inline-flex">
                <span className="text-[10px] font-black">{PLATFORM_SHORTCUT.shortcutLabel}</span>
              </kbd>
            )}
          </div>

          {showShuffle && onShuffleAll && (
            <NeoSecondaryAction
              label="Shuffle"
              icon={<Shuffle className="h-4 w-4" strokeWidth={3} />}
              onClick={onShuffleAll}
            />
          )}
        </div>

        <div
          data-tauri-drag-region
          aria-hidden="true"
          className="h-full w-3 shrink-0"
          style={titleDragStyle}
        />

        {/* Right: Status + Secondary Nav */}
        <div className="pointer-events-auto flex shrink-0 items-center justify-end gap-3" style={chromeNoDragStyle}>
          {status && <ProcessingStatus status={status} />}

          {navMode === 'topNav' && (
            <div className="flex items-center gap-2">
              {SECONDARY_TABS.map((item) => (
                <NeoSecondaryAction
                  key={item.view}
                  label={item.label}
                  icon={<item.icon className="h-4 w-4" strokeWidth={3} />}
                  onClick={() => onNavigate(item.view)}
                  active={currentView === item.view}
                />
              ))}
            </div>
          )}
        </div>

        {isWindowsDesktop && (
          <div className="flex h-full items-stretch">
            <WindowsWindowControls variant="neo" className="h-full" />
          </div>
        )}
      </div>
    </header>
  );
});

TopBarNeo.displayName = 'TopBarNeo';
