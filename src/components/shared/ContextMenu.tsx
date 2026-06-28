import { clsx } from 'clsx';
import { memo, useCallback, useEffect, useRef } from 'react';
import type { ContextMenuPosition } from '../../types';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu = memo(({ position, items, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (position) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [position, onClose]);

  const handleItemClick = useCallback(
    (item: ContextMenuItem) => {
      if (!item.disabled) {
        item.onClick();
        onClose();
      }
    },
    [onClose],
  );

  if (!position) return null;

  // Adjust position to stay within viewport
  const adjustedStyle = {
    left: Math.min(position.x, window.innerWidth - 200),
    top: Math.min(position.y, window.innerHeight - items.length * 40 - 20),
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[200px] max-w-[280px] bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 animate-fade-in"
      style={adjustedStyle}
    >
      {items.map((item, idx) => (
        <div key={item.id}>
          {item.divider && idx > 0 && (
            <div className="h-px bg-white/5 my-1.5 mx-2" role="separator" />
          )}
          <button
            role="menuitem"
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
            aria-label={item.label}
            className={clsx(
              'w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2.5',
              'transition-colors duration-100',
              item.disabled
                ? 'text-text-muted/50 cursor-not-allowed'
                : item.danger
                  ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                  : 'text-text-secondary hover:bg-white/5 hover:text-white',
            )}
          >
            {item.icon && <span className="w-4 h-4 opacity-60">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
});

ContextMenu.displayName = 'ContextMenu';
