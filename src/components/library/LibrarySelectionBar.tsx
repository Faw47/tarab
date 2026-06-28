import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { SelectionBarProps } from './library-view-types';

export const LibrarySelectionBar = memo(function LibrarySelectionBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  isNeo = false,
}: SelectionBarProps) {
  if (selectedCount <= 0) {
    return null;
  }

  return (
    <div
      className={cn(
        isNeo
          ? 'flex flex-wrap items-center justify-between gap-3 px-3 md:px-5 py-3 border-[3px] border-black bg-[#A855F7] shadow-[4px_4px_0_0_#000] shrink-0'
          : 'library-v2-selection',
      )}
    >
      <div className={cn(isNeo ? 'flex items-center gap-3' : 'library-v2-selection-copy')}>
        <span
          className={cn(
            isNeo
              ? 'px-2 py-0.5 border-[2px] border-black bg-[#F6F6F6] text-[10px] font-black uppercase tracking-[0.12em] text-black shadow-[2px_2px_0_0_#000]'
              : '',
          )}
        >
          {isNeo ? 'BATCH OPS' : 'Selected'}
        </span>
        <strong
          className={cn(
            isNeo ? 'font-mono text-sm font-black tracking-[0.08em] text-black' : '',
          )}
        >
          {selectedCount} {selectedCount === 1 ? 'FILE' : 'FILES'} SELECTED
        </strong>
      </div>

      <div className={cn(isNeo ? 'flex flex-wrap items-center gap-2' : 'library-v2-selection-actions')}>
        {onSelectAll && (
          <button
            type="button"
            onClick={onSelectAll}
            className={cn(
              isNeo
                ? 'inline-flex h-9 items-center justify-center border-[2px] border-black bg-[#F6F6F6] px-3 text-[11px] font-black uppercase tracking-[0.08em] text-black shadow-[2px_2px_0_0_#000] transition-none hover:bg-[#E4C463] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer'
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
                ? 'inline-flex h-9 items-center justify-center border-[2px] border-black bg-black px-3 text-[11px] font-black uppercase tracking-[0.08em] text-[#A855F7] shadow-[2px_2px_0_0_#FFF] shadow-black/80 transition-none hover:bg-[#F87171] hover:text-black active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer'
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
