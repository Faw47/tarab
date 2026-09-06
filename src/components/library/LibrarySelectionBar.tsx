import { Edit2 } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { SelectionBarProps } from './library-view-types';

export const LibrarySelectionBar = memo(function LibrarySelectionBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onEditSelected,
  isNeo = false,
}: SelectionBarProps) {
  if (selectedCount <= 0) {
    return null;
  }

  return (
    <div
      className={cn(
        isNeo
          ? 'flex flex-wrap items-center justify-between gap-3 px-3 md:px-5 py-3 border-[3px] border-[var(--neo-ink)] bg-[var(--signal-secondary)] shadow-[var(--neo-shadow-md)] shrink-0'
          : 'library-v2-selection',
      )}
    >
      <div className={cn(isNeo ? 'flex items-center gap-3' : 'library-v2-selection-copy')}>
        <span
          className={cn(
            isNeo
              ? 'px-2 py-0.5 border-[2px] border-[var(--neo-ink)] bg-[var(--neo-panel)] text-[12px] font-black uppercase tracking-[0.12em] text-[var(--neo-ink)] shadow-[var(--neo-shadow-xs)]'
              : '',
          )}
        >
          {isNeo ? 'BATCH OPS' : 'Selected'}
        </span>
        <strong
          className={cn(isNeo ? 'font-mono text-sm font-black tracking-[0.08em] text-black' : '')}
        >
          {selectedCount} {selectedCount === 1 ? 'FILE' : 'FILES'} SELECTED
        </strong>
      </div>

      <div
        className={cn(isNeo ? 'flex flex-wrap items-center gap-2' : 'library-v2-selection-actions')}
      >
        {isNeo && onEditSelected && (
          <button
            type="button"
            onClick={onEditSelected}
            title={`Edit ${selectedCount} selected`}
            aria-label={`Edit ${selectedCount} selected`}
            className="inline-flex h-9 items-center justify-center gap-2 border-[2px] border-[var(--neo-ink)] bg-[var(--neo-panel)] px-3 text-[12px] font-black uppercase tracking-[0.08em] text-[var(--neo-ink)] shadow-[var(--neo-shadow-xs)] transition-none hover:bg-[var(--neo-utility-hover)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
          >
            <Edit2 className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
            <span>EDIT TAGS</span>
          </button>
        )}
        {onSelectAll && (
          <button
            type="button"
            onClick={onSelectAll}
            className={cn(
              isNeo
                ? 'inline-flex h-9 items-center justify-center border-[2px] border-[var(--neo-ink)] bg-[var(--neo-panel)] px-3 text-[12px] font-black uppercase tracking-[0.08em] text-[var(--neo-ink)] shadow-[var(--neo-shadow-xs)] transition-none hover:bg-[var(--neo-utility-hover)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer'
                : '',
            )}
          >
            {isNeo ? 'MARK ALL' : 'Select all'}
          </button>
        )}
        {onClearSelection && (
          <button
            type="button"
            onClick={onClearSelection}
            className={cn(
              isNeo
                ? 'inline-flex h-9 items-center justify-center border-[2px] border-[var(--neo-ink)] bg-[var(--neo-ink)] px-3 text-[12px] font-black uppercase tracking-[0.08em] text-[var(--signal-secondary)] shadow-[var(--neo-shadow-xs-paper)] transition-none hover:bg-[var(--signal-danger)] hover:text-[var(--neo-ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer'
                : '',
            )}
          >
            {isNeo ? 'CLEAR' : 'Clear'}
          </button>
        )}
      </div>
    </div>
  );
});
