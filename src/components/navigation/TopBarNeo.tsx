import {
  ChevronLeft,
  Home,
  Library,
  ListMusic,
  Loader2,
  type LucideIcon,
  Search,
  Settings,
  Shuffle,
  Tag,
  X,
} from 'lucide-react';
import { type CSSProperties, memo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useEffectiveReducedEffects } from '../../hooks/useEffectiveReducedEffects';
import { QueueIcon } from '../ui/Icons';
import { type NavView, normalizeDockActiveView } from './navigation-model';
import {
  getTopBarLabel,
  TOP_BAR_PRIMARY_VIEWS,
  TOP_BAR_SECONDARY_VIEWS,
  type TopBarProcessingTask,
  type TopBarStatus,
} from './top-bar-model';
import { useTopBarController } from './useTopBarController';
import { WindowsWindowControls } from './WindowsWindowControls';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopBarNeoProps {
  navMode: 'iconRail' | 'topNav';
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isScanning: boolean;
  scanProgress: number;
  activeProcessing?: TopBarProcessingTask;
  titlebarInsetLeft?: number;
  onShuffleAll?: () => void;
  isSearching?: boolean;
  isScrolled?: boolean;
  focusSearchNonce?: number;
  onBack?: () => void;
  canGoBack?: boolean;
  // NOTE: Secondary tabs (Tags, Settings) are intentionally absent in
  // iconRail mode — FloatingDock owns them in that layout. This is a
  // deliberate design contract, not an oversight.
}

// ---------------------------------------------------------------------------
// Module-level constants
//
// Platform detection runs once at module load. The platform never changes
// mid-session, so computing this inside a hook (with a ref cache) is
// unnecessary overhead.
// ---------------------------------------------------------------------------

const SEARCH_INPUT_ID = 'global-library-search-neo';

const PRIMARY_TABS = TOP_BAR_PRIMARY_VIEWS.map((item) => ({
  ...item,
  icon: {
    home: Home,
    library: Library,
    queue: QueueIcon as LucideIcon,
    playlists: ListMusic,
  }[item.view],
}));

const SECONDARY_TABS = TOP_BAR_SECONDARY_VIEWS.map((item) => ({
  ...item,
  icon: {
    tags: Tag,
    settings: Settings,
  }[item.view],
}));

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
//   Header shell:             var(--neo-muted)
//   Primary nav idle:         #FFFFFF  | hover: var(--neo-sage)
//   Search field:             #FFFFFF at rest | focus-within: var(--neo-lavender)
//   Secondary actions idle:   var(--neo-panel)  | hover: var(--neo-utility-hover) (mustard)
//   Active / pressed:         #000000 bg, #FFFFFF text
// ---------------------------------------------------------------------------

const BUTTON_BASE_CLASS =
  'inline-flex items-center justify-center gap-3 border-2 border-[var(--neo-ink)] font-black uppercase tracking-[0.15em] transition-none focus-visible:outline-none rounded-none cursor-pointer';

// Primary nav buttons — 4px hard shadow
// Active state: background: var(--signal-active), border: 2px solid #000000, padding: 6px equivalent
const primaryButtonStateClass = (active: boolean) =>
  active
    ? 'bg-transparent text-black border-2 border-black shadow-none'
    : 'bg-[var(--neo-paper)] text-[var(--neo-ink)] shadow-[var(--neo-shadow-md)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:bg-[var(--neo-sage)]';

// Secondary action buttons — 2px hard shadow
const secondaryButtonStateClass = (active: boolean) =>
  active
    ? 'bg-black text-white translate-x-[2px] translate-y-[2px] shadow-none'
    : 'bg-[var(--neo-panel)] text-[var(--neo-ink)] shadow-[var(--neo-shadow-md)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none hover:bg-[var(--neo-utility-hover)]';

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
      className={cn(
        BUTTON_BASE_CLASS,
        primaryButtonStateClass(isActive),
        'h-10 px-0 pr-5 text-[12px] overflow-hidden',
      )}
    >
      <div
        className={cn(
          'flex h-full aspect-square items-center justify-center border-r-2 border-inherit transition-none',
          isActive ? 'bg-[var(--signal-active)]' : 'bg-transparent',
        )}
      >
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
      className={cn(BUTTON_BASE_CLASS, secondaryButtonStateClass(active), 'h-10 px-4 text-[12px]')}
    >
      {icon}
      <span className="hidden lg:inline-block">{label}</span>
    </button>
  );
});

NeoSecondaryAction.displayName = 'NeoSecondaryAction';

const ProcessingStatus = memo(function ProcessingStatus({
  status,
  reducedEffects,
}: {
  status: TopBarStatus;
  reducedEffects: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="relative flex h-10 min-w-[180px] max-w-[240px] items-center gap-3 overflow-hidden border-2 border-black bg-white px-3 shadow-[var(--neo-shadow-md)]"
    >
      <Loader2
        className={cn('h-4 w-4 shrink-0 text-black', !reducedEffects && 'animate-spin')}
        strokeWidth={3}
        aria-hidden
      />
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
            className="h-full border-r-2 border-black bg-[var(--state-warning-surface)]"
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
  onBack,
  canGoBack = false,
}: TopBarNeoProps) {
  const reducedEffects = useEffectiveReducedEffects();
  const {
    registerSearchInput,
    shortcutLabel,
    ariaShortcut,
    status,
    showShuffle,
    focusSearchInput,
    handleSearchChange,
  } = useTopBarController({
    inputId: SEARCH_INPUT_ID,
    currentView,
    searchQuery,
    onSearchChange,
    onNavigate,
    isScanning,
    scanProgress,
    activeProcessing,
    onShuffleAll,
    focusSearchNonce,
    scanningLabel: 'Scanning Library',
  });
  const isWindowsDesktop = /Win/i.test(navigator.platform);
  const navigationView = normalizeDockActiveView(currentView);

  const currentSectionLabel =
    (currentView === 'search'
      ? 'Search'
      : currentView === 'album'
        ? 'Album'
        : getTopBarLabel(currentView)) ?? 'Browse';

  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center border-b-2 border-black bg-[var(--neo-muted)] px-4">
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
          {canGoBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              title="Back"
              className="mr-2 inline-flex h-10 w-10 items-center justify-center border-2 border-black bg-white text-black shadow-[var(--neo-shadow-md)] hover:bg-[var(--neo-utility-hover)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={3} aria-hidden />
            </button>
          )}
          {navMode === 'topNav' ? (
            <>
              <div className="flex h-10 items-center border-2 border-black bg-[var(--neo-sage)] px-4 shadow-[var(--neo-shadow-md)] md:hidden">
                <span className="text-[13px] font-black uppercase tracking-[0.1em] text-black">
                  {currentSectionLabel}
                </span>
              </div>
              <nav
                aria-label="Primary sections"
                className="hidden items-center gap-2 border-2 border-black bg-white p-1 shadow-[var(--neo-shadow-md)] md:flex"
              >
                {PRIMARY_TABS.map((item) => (
                  <NeoNavButton
                    key={item.view}
                    view={item.view}
                    label={item.label}
                    icon={item.icon}
                    isActive={navigationView === item.view}
                    onNavigate={onNavigate}
                  />
                ))}
              </nav>
            </>
          ) : (
            <div className="inline-flex h-10 items-center border-2 border-black bg-[var(--neo-sage)] px-4 shadow-[var(--neo-shadow-md)]">
              <span className="text-[13px] font-black uppercase tracking-[0.1em] text-black">
                {currentSectionLabel}
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
        <div
          className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2"
          style={chromeNoDragStyle}
        >
          <div className="flex h-10 w-full items-center gap-3 border-2 border-black bg-white px-4 shadow-[var(--neo-shadow-md)] transition-none focus-within:bg-[var(--neo-lavender)]">
            <div className="flex shrink-0 items-center justify-center">
              {isSearching ? (
                <Loader2
                  className={cn('h-4 w-4 text-black', !reducedEffects && 'animate-spin')}
                  strokeWidth={3}
                  aria-hidden
                />
              ) : (
                <Search className="h-4 w-4 text-black" strokeWidth={3} />
              )}
            </div>

            <input
              ref={registerSearchInput(0)}
              id={SEARCH_INPUT_ID}
              type="text"
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="SEARCH..."
              aria-label="Search library"
              aria-keyshortcuts={ariaShortcut}
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-black uppercase tracking-[0.05em] text-black placeholder:text-black/30 outline-none"
            />

            {searchQuery ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSearchChange('');
                  focusSearchInput();
                }}
                className="inline-flex h-6 w-6 items-center justify-center border-2 border-black bg-[var(--neo-panel)] text-black shadow-[var(--neo-shadow-xs)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none hover:bg-[var(--neo-utility-hover)]"
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            ) : (
              <kbd className="hidden h-6 items-center border-2 border-black bg-[var(--neo-panel)] px-2 shadow-[var(--neo-shadow-xs)] md:inline-flex">
                <span className="text-xs font-black">{shortcutLabel}</span>
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
        <div
          className="pointer-events-auto flex shrink-0 items-center justify-end gap-3"
          style={chromeNoDragStyle}
        >
          {status && <ProcessingStatus status={status} reducedEffects={reducedEffects} />}

          {navMode === 'topNav' && (
            <div className="hidden items-center gap-2 md:flex">
              {SECONDARY_TABS.map((item) => (
                <NeoSecondaryAction
                  key={item.view}
                  label={item.label}
                  icon={<item.icon className="h-4 w-4" strokeWidth={3} />}
                  onClick={() => onNavigate(item.view)}
                  active={navigationView === item.view}
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
