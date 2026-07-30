import { clsx } from 'clsx';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
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

const MENU_MIN_WIDTH = 200;
const MENU_MARGIN = 8;
const MENU_ROW_HEIGHT = 40;

type FocusableElement = HTMLElement & { focus: () => void };

export const ContextMenu = memo(({ position, items, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousFocusRef = useRef<FocusableElement | null>(null);
  const typeaheadRef = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({
    text: '',
    timer: null,
  });

  const enabledIndexes = useMemo(
    () => items.flatMap((item, index) => (item.disabled ? [] : [index])),
    [items],
  );

  const focusItem = useCallback((index: number) => {
    itemRefs.current[index]?.focus();
  }, []);

  useEffect(() => {
    if (!position) return;

    previousFocusRef.current = document.activeElement as FocusableElement | null;
    const firstEnabled = enabledIndexes[0];
    const focusTimer = window.setTimeout(() => {
      if (firstEnabled !== undefined) focusItem(firstEnabled);
    }, 0);

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', handleClickOutside);
      if (typeaheadRef.current.timer) {
        clearTimeout(typeaheadRef.current.timer);
        typeaheadRef.current.timer = null;
      }
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [enabledIndexes, focusItem, onClose, position]);

  const handleItemClick = useCallback(
    (item: ContextMenuItem) => {
      if (!item.disabled) {
        item.onClick();
        onClose();
      }
    },
    [onClose],
  );

  const focusRelativeItem = useCallback(
    (direction: 1 | -1) => {
      if (enabledIndexes.length === 0) return;
      const activeIndex = itemRefs.current.findIndex((button) => button === document.activeElement);
      const enabledPosition = enabledIndexes.indexOf(activeIndex);
      const nextPosition =
        enabledPosition < 0
          ? 0
          : (enabledPosition + direction + enabledIndexes.length) % enabledIndexes.length;
      focusItem(enabledIndexes[nextPosition]);
    },
    [enabledIndexes, focusItem],
  );

  const handleTypeahead = useCallback(
    (key: string) => {
      const nextText = `${typeaheadRef.current.text}${key}`.toLowerCase();
      typeaheadRef.current.text = nextText;
      if (typeaheadRef.current.timer) clearTimeout(typeaheadRef.current.timer);
      typeaheadRef.current.timer = setTimeout(() => {
        typeaheadRef.current.text = '';
        typeaheadRef.current.timer = null;
      }, 500);

      const matchIndex = enabledIndexes.find((index) =>
        items[index]?.label.toLowerCase().startsWith(nextText),
      );
      if (matchIndex !== undefined) focusItem(matchIndex);
    },
    [enabledIndexes, focusItem, items],
  );

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose();
          return;
        case 'ArrowDown':
          event.preventDefault();
          focusRelativeItem(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          focusRelativeItem(-1);
          return;
        case 'Home':
          event.preventDefault();
          if (enabledIndexes[0] !== undefined) focusItem(enabledIndexes[0]);
          return;
        case 'End': {
          event.preventDefault();
          const lastIndex = enabledIndexes.at(-1);
          if (lastIndex !== undefined) focusItem(lastIndex);
          return;
        }
        default:
          if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
            handleTypeahead(event.key);
          }
      }
    },
    [enabledIndexes, focusItem, focusRelativeItem, handleTypeahead, onClose],
  );

  if (!position) return null;

  const menuHeight = Math.min(
    items.length * MENU_ROW_HEIGHT + 12,
    window.innerHeight - MENU_MARGIN * 2,
  );
  const adjustedStyle = {
    left: Math.max(
      MENU_MARGIN,
      Math.min(position.x, window.innerWidth - MENU_MIN_WIDTH - MENU_MARGIN),
    ),
    top: Math.max(MENU_MARGIN, Math.min(position.y, window.innerHeight - menuHeight - MENU_MARGIN)),
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className="glass-overlay-menu fixed z-50 min-w-[200px] max-w-[280px] py-1.5"
      style={adjustedStyle}
      onKeyDown={handleMenuKeyDown}
    >
      {items.map((item, idx) => (
        <div key={item.id}>
          {item.divider && idx > 0 && (
            <div className="h-px bg-white/5 my-1.5 mx-2" role="separator" />
          )}
          <button
            ref={(node) => {
              itemRefs.current[idx] = node;
            }}
            type="button"
            role="menuitem"
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
            aria-label={item.label}
            className={clsx(
              'w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2.5 outline-none',
              'transition-colors duration-[var(--motion-fast)] focus-visible:bg-white/10 focus-visible:text-white',
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
