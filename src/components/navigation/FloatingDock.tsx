import { clsx } from 'clsx';
import { Home, Settings } from 'lucide-react';
import { memo, type RefObject, useCallback, useLayoutEffect, useRef } from 'react';
import {
  applyHorizontalPillDom,
  useLiquidSegmentedPillHorizontal,
} from '@/hooks/use-liquid-segmented-pill';
import { useSettingsStore } from '../../store/settings-store';
import { Button } from '../ui/button';
import { LibraryIcon, QueueIcon, TagIcon } from '../ui/Icons';
import { BottomRim, glssDeep, LensArc } from '../ui/liquid-glass';

export type NavView = 'home' | 'library' | 'search' | 'queue' | 'tags' | 'settings' | 'album';

interface FloatingDockProps {
  activeView: NavView;
  onNavigate: (view: NavView) => void;
}

interface DockItem {
  id: NavView;
  icon: React.ReactNode;
  label: string;
}

const dockItems: DockItem[] = [
  { id: 'home', icon: <Home className="w-5 h-5" />, label: 'Home' },
  { id: 'library', icon: <LibraryIcon className="w-5 h-5" />, label: 'Library' },
  { id: 'queue', icon: <QueueIcon className="w-5 h-5" />, label: 'Queue' },
  { id: 'tags', icon: <TagIcon className="w-5 h-5" />, label: 'Tags' },
  { id: 'settings', icon: <Settings className="w-5 h-5" />, label: 'Settings' },
];

export const FloatingDock = memo(({ activeView, onNavigate }: FloatingDockProps) => {
  const theme = useSettingsStore((s) => s.theme);
  const isNeobrutalism = theme === 'neobrutalism';
  const shellRef = useRef<HTMLDivElement>(null);
  const glassPillRef = useRef<HTMLDivElement>(null);
  const dockActiveIndex = dockItems.findIndex((item) => item.id === activeView);

  const liquidEnabled = !isNeobrutalism && dockActiveIndex >= 0;

  const onCommitDockIndex = useCallback(
    (index: number) => {
      const item = dockItems[index];
      if (!item) return;
      onNavigate(item.id);
    },
    [onNavigate],
  );

  const {
    pillStyle,
    isDragging,
    pillLayoutFromDom,
    dragPreviewIndex,
    pillGeometryRef,
    suppressNextTabClickRef,
    listProps,
  } = useLiquidSegmentedPillHorizontal({
    rootRef: shellRef,
    pillElementRef: glassPillRef,
    tabSelector: 'button',
    activeIndex: dockActiveIndex >= 0 ? dockActiveIndex : 0,
    onCommitIndex: onCommitDockIndex,
    syncDependencies: [activeView],
    enabled: liquidEnabled,
  });

  useLayoutEffect(() => {
    if (!pillLayoutFromDom) return;
    const el = glassPillRef.current;
    const g = pillGeometryRef.current;
    if (el && g) applyHorizontalPillDom(el, g.left, g.width);
  }, [pillLayoutFromDom, dragPreviewIndex, isDragging, pillGeometryRef]);

  const showGlassHighlight = liquidEnabled && pillStyle.opacity > 0;

  return (
    <nav
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 w-[min(460px,calc(100%-1.5rem))]"
      role="navigation"
      aria-label="Main navigation"
    >
      <div
        ref={shellRef}
        className={clsx(
          'relative overflow-hidden transition-all duration-300',
          isNeobrutalism
            ? 'rounded-none border-2 border-black bg-[var(--surface-shell)] shadow-[4px_4px_0_0_#000]'
            : 'rounded-[28px]',
        )}
        style={
          isNeobrutalism
            ? undefined
            : {
                ...glssDeep(28),
                background:
                  'linear-gradient(180deg, rgba(20,15,12,0.76) 0%, rgba(11,10,10,0.92) 100%), radial-gradient(circle at 20% 0%, var(--surface-tint) 0%, transparent 36%)',
                boxShadow:
                  '0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 1px rgba(255,255,255,0.06)',
              }
        }
        {...listProps}
      >
        {!isNeobrutalism && (
          <>
            <LensArc opacity={0.5} />
            <BottomRim />
          </>
        )}

        {showGlassHighlight && (
          <div
            ref={glassPillRef}
            className={clsx(
              'absolute top-1 bottom-1 rounded-2xl z-0 border border-white/[0.08]',
              isDragging || pillLayoutFromDom
                ? 'transition-none'
                : 'transition-[left,width,opacity] duration-200 ease-out motion-reduce:transition-none',
            )}
            style={{
              ...(pillLayoutFromDom
                ? {}
                : { left: pillStyle.left, width: pillStyle.width, opacity: pillStyle.opacity }),
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, var(--surface-tint) 100%)',
              boxShadow: '0 0 22px var(--hero-glow)',
            }}
          />
        )}

        <div className="relative z-10 flex items-center justify-between px-2 py-2 gap-1">
          {dockItems.map((item, dockIndex) => (
            <DockButton
              key={item.id}
              item={item}
              isActive={
                dragPreviewIndex !== null ? dragPreviewIndex === dockIndex : activeView === item.id
              }
              isNeobrutalism={isNeobrutalism}
              liquidStripSuppressClickRef={liquidEnabled ? suppressNextTabClickRef : undefined}
              onClick={() => {
                onNavigate(item.id);
              }}
            />
          ))}
        </div>
      </div>
    </nav>
  );
});

interface DockButtonProps {
  item: DockItem;
  isActive: boolean;
  isNeobrutalism: boolean;
  onClick: () => void;
  liquidStripSuppressClickRef?: RefObject<boolean>;
}

const DockButton = memo(
  ({ item, isActive, isNeobrutalism, onClick, liquidStripSuppressClickRef }: DockButtonProps) => {
    return (
      <Button
        variant="ghost"
        onClick={() => {
          if (liquidStripSuppressClickRef?.current) {
            liquidStripSuppressClickRef.current = false;
            return;
          }
          onClick();
        }}
        className={clsx(
          'relative flex-1 min-w-0 h-auto items-center justify-center px-3 py-2.5 transition-all duration-200 group flex gap-2 overflow-hidden',
          isNeobrutalism
            ? 'rounded-none border-2 border-transparent text-black hover:bg-[var(--neo-panel)]'
            : 'rounded-2xl hover:bg-transparent active:translate-x-[1px] active:translate-y-[1px]',
          !isNeobrutalism && (isActive ? 'text-primary' : 'text-text-secondary hover:text-white'),
        )}
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
      >
        {!isNeobrutalism && (
          <span className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-70 transition-opacity" />
        )}
        <div
          className={clsx(
            'relative flex items-center justify-center rounded-none',
            isNeobrutalism
              ? 'shrink-0 transition-none'
              : 'h-10 w-10 transition-transform duration-200',
            isActive
              ? isNeobrutalism
                ? 'inline-flex bg-[var(--signal-active)] p-[6px] text-black border-2 border-black shadow-none'
                : 'h-10 w-10 bg-white text-black ring-2 ring-primary/[0.3] translate-x-[1px] translate-y-[1px]'
              : isNeobrutalism
                ? 'h-10 w-10 bg-white text-black border-2 border-black shadow-[4px_4px_0_0_#000]'
                : 'bg-white/10 text-text-secondary group-hover:bg-white/[0.15] shadow-[0_10px_25px_rgba(0,0,0,0.25)]',
          )}
          style={
            !isNeobrutalism && isActive ? { boxShadow: '0 0 24px var(--hero-glow)' } : undefined
          }
        >
          {item.icon}
        </div>
        <span
          className={clsx(
            'text-xs font-black uppercase tracking-[0.05em] transition-none truncate',
            isNeobrutalism ? 'text-black' : isActive ? 'text-text-primary' : 'text-text-muted',
          )}
        >
          {item.label}
        </span>
      </Button>
    );
  },
);

FloatingDock.displayName = 'FloatingDock';
DockButton.displayName = 'DockButton';
