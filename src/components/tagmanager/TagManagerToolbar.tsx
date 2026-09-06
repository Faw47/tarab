import { clsx } from 'clsx';
import {
  CheckSquare,
  ChevronDown,
  Edit2,
  Folder,
  Library,
  Search,
  Square,
  Tag,
} from 'lucide-react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import { Input } from '../ui/Input';
import { StatePanel } from '../ui/StatePanel';
import type { FileFilter, FolderNode } from './tag-manager-model';

interface TagManagerToolbarProps {
  allSelected: boolean;
  fileFilter: FileFilter;
  filteredTrackCount: number;
  folderTree: FolderNode[];
  handleSourceMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  hydrationError: string | null;
  hydrationLoadedCount: number;
  hydrationTotalCount: number;
  isLibraryHydrating: boolean;
  queryInput: string;
  retryHydration: () => void | Promise<void>;
  selectedFolder: string | null;
  selectedFolderName: string;
  selectedTrackCount: number;
  setFileFilter: (filter: FileFilter) => void;
  setQueryInput: Dispatch<SetStateAction<string>>;
  setSelectedFolder: (folder: string | null) => void;
  setShowNarrowEditor: Dispatch<SetStateAction<boolean>>;
  setShowSourceDropdown: Dispatch<SetStateAction<boolean>>;
  showSourceDropdown: boolean;
  sourceDropdownRef: RefObject<HTMLDivElement | null>;
  sourceTriggerRef: RefObject<HTMLButtonElement | null>;
  handleToggleAll: () => void;
}

export function TagManagerToolbar({
  allSelected,
  fileFilter,
  filteredTrackCount,
  folderTree,
  handleSourceMenuKeyDown,
  hydrationError: libraryHydrationError,
  hydrationLoadedCount,
  hydrationTotalCount,
  isLibraryHydrating,
  queryInput,
  retryHydration,
  selectedFolder,
  selectedFolderName,
  selectedTrackCount,
  setFileFilter,
  setQueryInput,
  setSelectedFolder,
  setShowNarrowEditor,
  setShowSourceDropdown,
  showSourceDropdown,
  sourceDropdownRef,
  sourceTriggerRef,
  handleToggleAll,
}: TagManagerToolbarProps) {
  return (
    <>
      {/* Slim Toolbar Header */}{' '}
      <div className="tag-manager-toolbar min-h-16 shrink-0 border-b border-white/5 bg-card flex flex-wrap items-center px-3 py-2 gap-2 z-20 backdrop-blur-md lg:flex-nowrap lg:px-4 lg:gap-4">
        <div className="tag-manager-toolbar-divider flex items-center gap-3 pr-4 border-r border-white/10">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Tag className="w-4 h-4 text-primary" />
          </div>
          <h1 className="hidden text-lg font-bold text-foreground tracking-normal xl:block">
            Tag Editor
          </h1>
        </div>

        {/* Source Dropdown */}
        <div className="relative" ref={sourceDropdownRef}>
          <button
            ref={sourceTriggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowSourceDropdown((v) => !v);
            }}
            disabled={isLibraryHydrating}
            className="tag-manager-control flex w-[180px] max-w-[42vw] min-w-0 items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm font-medium transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            aria-haspopup="menu"
            aria-expanded={showSourceDropdown}
            aria-label={`Library source: ${selectedFolderName}`}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              setShowSourceDropdown(true);
              queueMicrotask(() => {
                const items =
                  sourceDropdownRef.current?.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitemradio"]',
                  );
                items?.[event.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
              });
            }}
          >
            {selectedFolder ? (
              <Folder className="w-4 h-4 text-primary" />
            ) : (
              <Library className="w-4 h-4 text-primary" />
            )}
            <span className="truncate max-w-[140px]">{selectedFolderName}</span>
            <ChevronDown className="w-3 h-3 ml-auto opacity-50" />
          </button>

          {showSourceDropdown && (
            <div
              className="tag-manager-menu absolute top-full left-0 mt-2 w-72 bg-[#1a1a1a] border border-white/10 rounded-xl py-1 shadow-2xl overflow-y-auto max-h-[420px] z-50 custom-scrollbar"
              role="menu"
              aria-label="Library source"
              onKeyDown={handleSourceMenuKeyDown}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selectedFolder === null}
                onClick={() => {
                  setSelectedFolder(null);
                  setShowSourceDropdown(false);
                }}
                disabled={isLibraryHydrating}
                className="tag-manager-menu-item w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Library className="w-4 h-4 text-primary" />
                <span>All Library</span>
                <span className="ml-auto text-xs opacity-50">{hydrationTotalCount}</span>
              </button>
              <div className="tag-manager-menu-separator h-px bg-white/5 my-1" />
              {folderTree.map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedFolder === folder.path}
                  onClick={() => {
                    setSelectedFolder(folder.path);
                    setShowSourceDropdown(false);
                  }}
                  disabled={isLibraryHydrating}
                  className={clsx(
                    'tag-manager-menu-item w-full flex items-center gap-3 px-4 py-2 hover:bg-white/5 text-xs disabled:cursor-not-allowed disabled:opacity-50',
                    selectedFolder === folder.path ? 'text-foreground' : 'text-text-secondary',
                  )}
                  title={folder.path}
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto opacity-50">{folder.trackCount}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="group relative order-last w-full flex-none lg:order-none lg:w-auto lg:max-w-md lg:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-primary transition-colors" />
          <Input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search..."
            aria-label="Search tracks for tag editing"
            className="tag-manager-input w-full bg-black/20 rounded-lg pl-9 pr-4 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 focus:bg-black/40 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] border border-white/5"
          />
        </div>

        {/* Filters */}
        <div className="tag-manager-filter-group flex items-center gap-1 bg-black/20 rounded-lg p-1 border border-white/5">
          {(['all', 'missing-art', 'untagged'] as FileFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setFileFilter(filter)}
              disabled={isLibraryHydrating}
              className={clsx(
                'tag-manager-filter-option px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wide transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] disabled:cursor-not-allowed disabled:opacity-50',
                fileFilter === filter
                  ? 'tag-manager-filter-option--active bg-white text-black shadow-sm'
                  : 'text-text-secondary hover:text-white',
              )}
            >
              {filter === 'all' ? 'all' : filter === 'missing-art' ? 'missing art' : 'untagged'}
            </button>
          ))}
        </div>

        {/* Stats + select all */}
        <div className="tag-manager-toolbar-divider ml-auto flex items-center gap-3 pl-4 border-l border-white/10">
          <span className="text-xs text-text-muted-strong">{filteredTrackCount} tracks</span>
          {selectedTrackCount > 0 && (
            <button
              type="button"
              onClick={() => setShowNarrowEditor(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 text-xs font-bold text-black lg:hidden"
              aria-label="Edit selected tracks"
            >
              <Edit2 className="h-3.5 w-3.5" />
              Edit {selectedTrackCount}
            </button>
          )}
          <button
            type="button"
            onClick={handleToggleAll}
            disabled={isLibraryHydrating || filteredTrackCount === 0}
            className="tag-manager-icon-button p-2 hover:bg-white/5 rounded-lg text-text-secondary hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            title={
              isLibraryHydrating
                ? 'Wait for the full library to load'
                : allSelected
                  ? 'Deselect all'
                  : 'Select all'
            }
            aria-label={
              isLibraryHydrating
                ? 'Loading full library before selecting all tracks'
                : allSelected
                  ? 'Deselect all tracks'
                  : 'Select all tracks'
            }
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
      {isLibraryHydrating && hydrationTotalCount > hydrationLoadedCount && (
        <div
          className="tag-manager-hydration shrink-0 border-b border-white/5 bg-black/30 px-4 py-2"
          role="status"
          aria-live="polite"
        >
          <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.12em] text-text-muted">
            <span>Loading full library for bulk editing</span>
            <span>
              {hydrationLoadedCount} / {hydrationTotalCount}
            </span>
          </div>
          <div className="tag-manager-progress-track h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="tag-manager-progress-fill h-full rounded-full bg-primary transition-[width] duration-[var(--motion-emphasis)]"
              style={{
                width: `${Math.round((hydrationLoadedCount / hydrationTotalCount) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
      {libraryHydrationError &&
        !isLibraryHydrating &&
        hydrationTotalCount > hydrationLoadedCount && (
          <StatePanel
            tone="error"
            title="Full library load failed; bulk editing is limited to loaded tracks."
            description={`${hydrationLoadedCount} / ${hydrationTotalCount} tracks loaded. ${libraryHydrationError}`}
            action={{ label: 'Retry', onClick: retryHydration }}
            className="shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2"
          />
        )}
    </>
  );
}

TagManagerToolbar.displayName = 'TagManagerToolbar';
