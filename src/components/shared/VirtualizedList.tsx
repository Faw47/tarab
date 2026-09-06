import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type {
  CSSProperties,
  FocusEvent,
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
  UIEvent,
} from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

type ScrollToIndexAlign = 'auto' | 'start' | 'center' | 'end';

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  overscan?: number;
  className?: string;
  style?: CSSProperties;
  containerProps?: Omit<
    HTMLAttributes<HTMLDivElement>,
    'children' | 'className' | 'style' | 'ref' | 'onScroll'
  >;
  renderItem: (item: T, index: number) => ReactNode;
  getItemKey?: (item: T, index: number) => string | number;
  onRangeChange?: (start: number, end: number) => void;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  scrollToIndexRef?: { current: ((index: number, align?: ScrollToIndexAlign) => void) | null };
  keyboardNavigation?: boolean;
  /** Called when scroll position passes 90% of content (for load more). Throttled. */
  onScrollNearEnd?: () => void | Promise<void>;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

const getFocusTarget = (node: HTMLElement): HTMLElement | null =>
  node.querySelector<HTMLElement>('[data-virtual-list-focus-target]') ??
  node.querySelector<HTMLElement>('[role=option]') ??
  node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);

export function VirtualizedList<T>({
  items,
  itemHeight,
  overscan = 8,
  className,
  style,
  renderItem,
  getItemKey,
  onRangeChange,
  onScroll,
  scrollToIndexRef,
  containerProps,
  keyboardNavigation = false,
  onScrollNearEnd,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId().replace(/:/g, '');
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearEndInFlightRef = useRef(false);
  const [rovingIndex, setRovingIndex] = useState(0);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const [activeDescendantId, setActiveDescendantId] = useState<string | undefined>();

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => itemHeight,
    overscan,
    getItemKey: getItemKey ? (index: number) => getItemKey(items[index], index) : undefined,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const isListbox = keyboardNavigation && containerProps?.role === 'listbox';
  const onContainerFocus = containerProps?.onFocus;
  const onContainerKeyDown = containerProps?.onKeyDown;

  useEffect(() => {
    setRovingIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    if (!keyboardNavigation) return;
    const nodes = containerRef.current?.querySelectorAll<HTMLElement>('[data-virtual-list-index]');
    nodes?.forEach((node) => {
      const index = Number(node.dataset.virtualListIndex);
      const focusTarget = getFocusTarget(node);
      if (focusTarget) focusTarget.tabIndex = index === rovingIndex ? 0 : -1;
    });
  }, [keyboardNavigation, rovingIndex, virtualItems]);

  useLayoutEffect(() => {
    if (!isListbox) {
      setActiveDescendantId((current) => (current === undefined ? current : undefined));
      return;
    }

    const node = containerRef.current?.querySelector<HTMLElement>(
      `[data-virtual-list-index="${rovingIndex}"]`,
    );
    const focusTarget = node ? getFocusTarget(node) : null;
    if (!focusTarget) {
      setActiveDescendantId((current) => (current === undefined ? current : undefined));
      return;
    }

    const nextId = focusTarget.id || `${listId}-item-${rovingIndex}`;
    if (!focusTarget.id) focusTarget.id = nextId;
    setActiveDescendantId((current) => (current === nextId ? current : nextId));
  }, [isListbox, listId, rovingIndex, virtualItems]);
  useEffect(() => {
    if (!keyboardNavigation || pendingFocusIndex === null) return;
    const node = containerRef.current?.querySelector<HTMLElement>(
      `[data-virtual-list-index="${pendingFocusIndex}"]`,
    );
    if (!node) return;
    const focusTarget = getFocusTarget(node);
    if (focusTarget) focusTarget.focus();
    setRovingIndex(pendingFocusIndex);
    setPendingFocusIndex(null);
  }, [keyboardNavigation, pendingFocusIndex, virtualItems]);

  useEffect(() => {
    if (!scrollToIndexRef) return;
    scrollToIndexRef.current = (index, align = 'auto') =>
      virtualizer.scrollToIndex(index, { align });
    return () => {
      scrollToIndexRef.current = null;
    };
  }, [scrollToIndexRef, virtualizer]);

  useEffect(() => {
    if (onRangeChange && virtualItems.length > 0) {
      onRangeChange(virtualItems[0].index, virtualItems[virtualItems.length - 1].index);
    }
  }, [virtualItems, onRangeChange]);

  useEffect(() => {
    if (!onScrollNearEnd || items.length === 0) return;
    const node = containerRef.current;
    if (!node) return;

    const check = () => {
      const { scrollTop, clientHeight, scrollHeight } = node;
      if (scrollHeight <= 0) return;
      if (scrollTop + clientHeight >= 0.9 * scrollHeight) {
        if (throttleRef.current !== null || nearEndInFlightRef.current) return;
        nearEndInFlightRef.current = true;
        const release = () => {
          nearEndInFlightRef.current = false;
        };
        try {
          const result = onScrollNearEnd();
          if (result && result instanceof Promise) {
            void result.then(release, release);
          } else {
            release();
          }
        } catch (error) {
          release();
          throw error;
        }
        throttleRef.current = setTimeout(() => {
          throttleRef.current = null;
        }, 400);
      }
    };

    check();
    node.addEventListener('scroll', check, { passive: true });
    return () => {
      node.removeEventListener('scroll', check);
      if (throttleRef.current !== null) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
    };
  }, [onScrollNearEnd, items.length]);

  const handleContainerFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (keyboardNavigation) {
      const node = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-list-index]');
      const index = Number(node?.dataset.virtualListIndex ?? -1);
      if (index >= 0) setRovingIndex(index);
    }
    onContainerFocus?.(event);
  };

  const handleContainerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (keyboardNavigation && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const target = event.target as HTMLElement;
      if (!target.matches('input, textarea, select, [contenteditable="true"]')) {
        const node = target.closest<HTMLElement>('[data-virtual-list-index]');
        const currentIndex = Number(node?.dataset.virtualListIndex ?? rovingIndex);
        let nextIndex = currentIndex;
        if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
        if (event.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, currentIndex + 1);
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = items.length - 1;
        if (nextIndex !== currentIndex && items.length > 0) {
          event.preventDefault();
          setRovingIndex(nextIndex);
          setPendingFocusIndex(nextIndex);
          virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
        }
      }
    }
    onContainerKeyDown?.(event);
  };

  return (
    <div
      ref={containerRef}
      {...containerProps}
      aria-activedescendant={
        isListbox ? activeDescendantId : containerProps?.['aria-activedescendant']
      }
      onFocus={handleContainerFocus}
      onKeyDown={handleContainerKeyDown}
      onScroll={onScroll}
      className={className}
      style={{ ...style, position: 'relative' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem: VirtualItem) => (
          <div
            key={virtualItem.key}
            data-virtual-list-index={virtualItem.index}
            role={
              keyboardNavigation
                ? containerProps?.role === 'listbox'
                  ? 'presentation'
                  : 'listitem'
                : undefined
            }
            aria-posinset={
              keyboardNavigation && containerProps?.role !== 'listbox'
                ? virtualItem.index + 1
                : undefined
            }
            aria-setsize={
              keyboardNavigation && containerProps?.role !== 'listbox' ? items.length : undefined
            }
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
