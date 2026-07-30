import { getCurrentWindow } from '@tauri-apps/api/window';
import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { useAsyncCleanup } from '@/hooks/useAsyncCleanup';
import { cn } from '@/lib/utils';

interface WindowsWindowControlsProps {
  variant?: 'liquid' | 'neo';
  className?: string;
}

const noDragStyle = {
  WebkitAppRegion: 'no-drag',
  appRegion: 'no-drag',
} as CSSProperties;

const isWindowsDesktop =
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  navigator.platform.toLowerCase().includes('win');

export const WindowsWindowControls = memo(function WindowsWindowControls({
  variant = 'liquid',
  className,
}: WindowsWindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  const syncWindowState = useCallback(async () => {
    try {
      const maximized = await getCurrentWindow().isMaximized();
      setIsMaximized(maximized);
    } catch {
      setIsMaximized(false);
    }
  }, []);

  useEffect(() => {
    if (!isWindowsDesktop) return;

    void syncWindowState();
  }, [syncWindowState]);

  useAsyncCleanup(async () => {
    if (!isWindowsDesktop) return () => undefined;
    return getCurrentWindow().onResized(() => {
      void syncWindowState();
    });
  }, [syncWindowState]);

  const handleMinimize = useCallback(() => {
    void getCurrentWindow()
      .minimize()
      .catch((error) => {
        console.error('Failed to minimize window:', error);
      });
  }, []);

  const handleToggleMaximize = useCallback(() => {
    void getCurrentWindow()
      .toggleMaximize()
      .then(() => syncWindowState())
      .catch(() => undefined);
  }, [syncWindowState]);

  const handleClose = useCallback(() => {
    void getCurrentWindow()
      .close()
      .catch((error) => {
        console.error('Failed to close window:', error);
      });
  }, []);

  const buttonClassName = useMemo(() => {
    if (variant === 'neo') {
      return 'h-10 w-12 border-2 border-black bg-[var(--neo-panel)] text-black shadow-[2px_2px_0_0_#000] transition-none hover:bg-[var(--neo-utility-hover)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none';
    }

    return 'h-8 w-[46px] rounded-none bg-transparent text-white/80 transition-colors duration-[var(--motion-fast)] hover:bg-white/10 hover:text-white';
  }, [variant]);

  const closeButtonClassName = useMemo(() => {
    if (variant === 'neo') {
      return 'h-10 w-12 border-2 border-black bg-[var(--neo-panel)] text-black shadow-[2px_2px_0_0_#000] transition-none hover:bg-[#ff5f56] hover:text-black active:translate-x-[2px] active:translate-y-[2px] active:shadow-none';
    }

    return 'h-8 w-[46px] rounded-none bg-transparent text-white/80 transition-colors duration-[var(--motion-fast)] hover:bg-[#e81123] hover:text-white';
  }, [variant]);

  if (!isWindowsDesktop) return null;

  return (
    <div className={cn('flex items-center', className)} style={noDragStyle}>
      <button
        type="button"
        onClick={handleMinimize}
        aria-label="Minimize window"
        title="Minimize"
        className={cn('inline-flex items-center justify-center', buttonClassName)}
      >
        <span aria-hidden="true" className="block h-[1.5px] w-3.5 bg-current" />
      </button>

      <button
        type="button"
        onClick={handleToggleMaximize}
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        title={isMaximized ? 'Restore' : 'Maximize'}
        className={cn('inline-flex items-center justify-center', buttonClassName)}
      >
        {isMaximized ? (
          <span aria-hidden="true" className="relative block h-3.5 w-3.5">
            <span className="absolute right-[0.5px] top-[0.5px] h-[8px] w-[8px] border-[1.5px] border-current" />
            <span className="absolute bottom-[0.5px] left-[0.5px] h-[8px] w-[8px] border-[1.5px] border-current" />
          </span>
        ) : (
          <span aria-hidden="true" className="block h-3 w-3 border-[1.5px] border-current" />
        )}
      </button>

      <button
        type="button"
        onClick={handleClose}
        aria-label="Close window"
        title="Close"
        className={cn('inline-flex items-center justify-center', closeButtonClassName)}
      >
        <span aria-hidden="true" className="relative block h-3.5 w-3.5">
          <span className="absolute left-0 top-1/2 h-[1.5px] w-3.5 -translate-y-1/2 rotate-45 bg-current" />
          <span className="absolute left-0 top-1/2 h-[1.5px] w-3.5 -translate-y-1/2 -rotate-45 bg-current" />
        </span>
      </button>
    </div>
  );
});
