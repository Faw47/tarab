import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
    <div
      data-virtual-grid-index={index}
      role="gridcell"
      tabIndex={-1}
      style={{ boxSizing: 'border-box', padding: CELL_GUTTER, height: '100%' }}
    >
      <div className="h-full w-full">{renderItem(item, index)}</div>
    </div>
  );
}

const MemoVirtualizedGridCell = memo(VirtualizedGridCell) as typeof VirtualizedGridCell;

export function VirtualizedGrid<T>({
  items,
  minColumnWidth,
  rowHeight = DEFAULT_ROW_HEIGHT,
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
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);

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
    if (pendingFocusIndex === null) return;
    const cell = containerRef.current?.querySelector<HTMLElement>(
      `[data-virtual-grid-index="${pendingFocusIndex}"]`,
    );
    if (!cell) return;
    (cell.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? cell).focus();
    setPendingFocusIndex(null);
  }, [pendingFocusIndex, virtualRows]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) return;

      const cell = target.closest<HTMLElement>('[data-virtual-grid-index]');
      const currentIndex = Number(cell?.dataset.virtualGridIndex ?? -1);
      let nextIndex: number;

      switch (event.key) {
        case 'ArrowLeft':
          nextIndex = Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
          break;
        case 'ArrowRight':
          nextIndex = Math.min(items.length - 1, currentIndex + 1);
          break;
        case 'ArrowUp':
          nextIndex = Math.max(0, currentIndex < 0 ? 0 : currentIndex - columns);
          break;
        case 'ArrowDown':
          nextIndex = Math.min(items.length - 1, currentIndex < 0 ? 0 : currentIndex + columns);
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = items.length - 1;
          break;
        default:
          return;
      }

      if (nextIndex < 0) return;
      event.preventDefault();
      rowVirtualizer.scrollToIndex(Math.floor(nextIndex / columns), { align: 'auto' });
      setPendingFocusIndex(nextIndex);
    },
    [columns, items.length, rowVirtualizer],
  );

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
      role="grid"
      aria-label="Library items"
      aria-colcount={columns}
      aria-rowcount={rowCount}
      tabIndex={0}
      onKeyDown={handleKeyDown}
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
              role="row"
              aria-rowindex={rowIndex + 1}
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
