import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode, UIEvent } from 'react';

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
  /** Called when scroll position passes 90% of content (for load more). Throttled. */
  onScrollNearEnd?: () => void;
}

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
  onScrollNearEnd,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => itemHeight,
    overscan,
    getItemKey: getItemKey ? (index: number) => getItemKey(items[index], index) : undefined,
  });

  const virtualItems = virtualizer.getVirtualItems();

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
        if (throttleRef.current) return;
        onScrollNearEnd();
        throttleRef.current = setTimeout(() => {
          throttleRef.current = null;
        }, 400);
      }
    };

    check();
    node.addEventListener('scroll', check, { passive: true });
    return () => {
      node.removeEventListener('scroll', check);
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, [onScrollNearEnd, items.length]);

  return (
    <div
      ref={containerRef}
      {...containerProps}
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
