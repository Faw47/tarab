import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

interface VirtualizedGridProps<T> {
  items: T[];
  minColumnWidth: number;
  rowHeight?: number;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
  getItemKey?: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => React.ReactNode;
  onRangeChange?: (start: number, end: number) => void;
  /** Called when scroll position passes 90% of content (for load more). */
  onScrollNearEnd?: () => void;
}

const CELL_GUTTER = 6;
const DEFAULT_ROW_HEIGHT = 220;

function VirtualizedGridCell<T>({
  item,
  index,
  renderItem,
}: {
  item: T;
  index: number;
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  return (
    <div style={{ boxSizing: 'border-box', padding: CELL_GUTTER, height: '100%' }}>
      <div className="h-full w-full">{renderItem(item, index)}</div>
    </div>
  );
}

const MemoVirtualizedGridCell = memo(VirtualizedGridCell) as typeof VirtualizedGridCell;

export function VirtualizedGrid<T>({
  items,
  minColumnWidth,
  rowHeight = DEFAULT_ROW_HEIGHT, // Now used for row estimation
  overscan = 3,
  className,
  style,
  renderItem,
  getItemKey,
  onRangeChange,
  onScrollNearEnd,
}: VirtualizedGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => {
    if (containerWidth === 0) return 1;
    return Math.max(1, Math.floor(containerWidth / minColumnWidth));
  }, [containerWidth, minColumnWidth]);

  const rowCount = Math.ceil(items.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight + CELL_GUTTER * 2,
    overscan,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (onRangeChange && virtualRows.length > 0) {
      const start = virtualRows[0].index * columns;
      const end = Math.min(
        items.length - 1,
        (virtualRows[virtualRows.length - 1].index + 1) * columns - 1,
      );
      onRangeChange(start, end);
    }
  }, [virtualRows, columns, items.length, onRangeChange]);

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
      className={className}
      style={{
        ...style,
        height: '100%',
        width: '100%',
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualRows.map((virtualRow) => {
          const rowIndex = virtualRow.index;
          const rowItems = [];
          for (let i = 0; i < columns; i++) {
            const itemIndex = rowIndex * columns + i;
            if (itemIndex < items.length) {
              rowItems.push({ item: items[itemIndex], index: itemIndex });
            }
          }

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
              }}
            >
              {rowItems.map(({ item, index }) => (
                <MemoVirtualizedGridCell
                  key={getItemKey ? getItemKey(item, index) : index}
                  item={item}
                  index={index}
                  renderItem={renderItem}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
