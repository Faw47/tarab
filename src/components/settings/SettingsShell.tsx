import { memo, useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';

import { FolderOpen, HardDrive, Layout, Monitor, Volume2 } from 'lucide-react';

import { applyVerticalPillDom, useLiquidSegmentedPillVertical } from '@/hooks/use-liquid-segmented-pill';
import { cn } from '@/lib/utils';

import type { SettingsPage } from '../../types';

import { SettingsNavTab } from './primitives';

export interface SettingsShellProps {
  page: SettingsPage;
  setPage: (page: SettingsPage) => void;
  isNeobrutalism: boolean;
  onScrollChange?: (scrolled: boolean) => void;
  children: React.ReactNode;
  overlays?: React.ReactNode;
}

export const SettingsShell = memo(function SettingsShell({
  page,
  setPage,
  isNeobrutalism,
  onScrollChange,
  children,
  overlays,
}: SettingsShellProps) {
  const navConfig = useMemo(
    () =>
      [
        { page: 'library' as const, label: 'Library', icon: <FolderOpen size={18} /> },
        { page: 'playback' as const, label: 'Playback', icon: <Volume2 size={18} /> },
        { page: 'appearance' as const, label: 'Appearance', icon: <Layout size={18} /> },
        { page: 'desktop' as const, label: 'Desktop', icon: <Monitor size={18} /> },
        { page: 'storage' as const, label: 'Storage', icon: <HardDrive size={18} /> },
      ] satisfies Array<{ page: SettingsPage; label: string; icon: ReactNode }>,
    [],
  );

  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const activeNavIndex = useMemo(
    () => Math.max(0, navConfig.findIndex((item) => item.page === page)),
    [navConfig, page],
  );

  const onCommitNavIndex = useCallback(
    (index: number) => {
      const item = navConfig[index];
      if (item) setPage(item.page);
    },
    [navConfig, setPage],
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
    activeIndex: activeNavIndex,
    onCommitIndex: onCommitNavIndex,
    syncDependencies: [page],
    enabled: !isNeobrutalism,
  });

  useLayoutEffect(() => {
    if (!pillLayoutFromDom) return;
    const el = pillRef.current;
    const g = pillGeometryRef.current;
    if (el && g) applyVerticalPillDom(el, g.top, g.height);
  }, [pillLayoutFromDom, dragPreviewIndex, isDragging, pillGeometryRef]);

  return (
    <div
      className={cn(
        'h-full flex flex-col md:flex-row bg-transparent',
        !isNeobrutalism && 'bg-gradient-to-b from-white/[0.03] via-transparent to-transparent',
        isNeobrutalism && 'text-black',
      )}
    >
      {/* Sidebar Navigation */}
      <div
        className={cn(
          'w-full md:w-72 shrink-0 p-6 flex flex-col gap-6 overflow-y-auto',
          isNeobrutalism ? 'md:border-r-2 md:border-black' : 'md:border-r border-white/[0.04]',
        )}
      >
        <div
          className={cn(
            'space-y-2 p-4',
            isNeobrutalism
              ? 'relative border-2 border-black bg-white shadow-[4px_4px_0_0_#000]'
              : 'rounded-2xl border border-white/[0.06] bg-black/20 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.1)]',
          )}
        >
          <span className={cn('neo-version-badge', !isNeobrutalism && 'hidden')}>TARAB V1.1</span>
          <h1
            className={cn(
              'mb-1 text-text-primary',
              isNeobrutalism
                ? 'border-b-2 border-black pb-3 text-3xl font-black uppercase leading-none tracking-[0.08em] text-black md:text-[2rem]'
                : 'text-2xl font-bold',
            )}
          >
            Settings
          </h1>
          <p className={cn('text-xs', isNeobrutalism ? 'font-bold uppercase tracking-[0.12em] text-black/70' : 'text-white/50')}>
            Instant apply enabled
          </p>
          <p className={cn('text-[11px]', isNeobrutalism ? 'font-bold uppercase tracking-[0.1em] text-black/55' : 'text-white/40')}>
            Destructive actions ask for confirmation.
          </p>
        </div>

        <div
          className={cn(
            !isNeobrutalism &&
              'rounded-2xl border border-white/[0.04] bg-white/[0.02] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
          )}
        >
          <nav
            ref={navRef}
            className={cn('relative flex flex-col', !isNeobrutalism ? 'gap-1' : 'gap-1.5')}
            aria-label="Settings sections"
            {...listProps}
          >
            {!isNeobrutalism && (
            <div
              ref={pillRef}
              className={cn(
                'absolute left-0 right-0 rounded-xl pointer-events-none motion-reduce:transition-none',
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
                  `  color-mix(in oklch, var(--surface-tint, rgba(255,255,255,0.08)) 60%, rgba(255,255,255,0.13)) 0%,`,
                  `  color-mix(in oklch, var(--surface-tint, rgba(255,255,255,0.08)) 30%, rgba(255,255,255,0.06)) 50%,`,
                  `  color-mix(in oklch, var(--surface-tint, rgba(255,255,255,0.08)) 10%, rgba(255,255,255,0.04)) 100%`,
                  ')',
                ].join(''),
                boxShadow: [
                  'inset 0 1px 0 rgba(255,255,255,0.18)',
                  'inset 0 -1px 0 rgba(0,0,0,0.08)',
                  `0 0 14px -6px rgb(var(--hero-accent-rgb, 255 255 255) / 0.40)`,
                  '0 2px 8px -4px rgba(0,0,0,0.25)',
                ].join(', '),
              }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 top-0 h-px rounded-full"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
                  opacity: 0.7,
                }}
              />
            </div>
            )}

            {navConfig.map((item, navIndex) => (
              <SettingsNavTab
                key={item.page}
                active={
                  dragPreviewIndex !== null ? dragPreviewIndex === navIndex : page === item.page
                }
                label={item.label}
                icon={item.icon}
                onClick={() => setPage(item.page)}
                liquidStripSuppressClickRef={!isNeobrutalism ? suppressNextTabClickRef : undefined}
              />
            ))}
          </nav>
        </div>
      </div>

      {/* Content Area */}
      <div
        className={cn(
          'flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10',
          !isNeobrutalism && 'md:p-8',
        )}
        onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop > 8)}
      >
        {children}
      </div>

      {overlays}
    </div>
  );
});

SettingsShell.displayName = 'SettingsShell';

