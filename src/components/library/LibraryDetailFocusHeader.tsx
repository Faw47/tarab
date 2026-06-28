import { ChevronLeft, Grid, List, Play } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { DetailFocusHeaderProps } from './library-view-types';

export const LibraryDetailFocusHeader = memo(function LibraryDetailFocusHeader({
  detailScope,
  trackCount,
  onBack,
  onPlayAll,
  isScrolled,
  viewMode,
  onViewModeChange,
}: DetailFocusHeaderProps) {
  const title = detailScope.type === 'album' ? detailScope.album : detailScope.artist;
  const subtitle = detailScope.type === 'album' ? detailScope.artist : 'Artist scope';

  return (
    <header className={cn('library-v2-detail-header', isScrolled && 'is-scrolled')}>
      <button type="button" className="library-v2-detail-back" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      <div className="library-v2-detail-copy">
        <h2 className="library-v2-detail-title">{title}</h2>
        <p className="library-v2-detail-subtitle">{subtitle}</p>
        <p className="library-v2-detail-kicker">
          {trackCount.toLocaleString()} {trackCount === 1 ? 'track' : 'tracks'} in focus
        </p>
      </div>

      <div className="library-v2-detail-actions">
        <div className="library-v2-view-mode" role="group" aria-label="View mode">
          <button
            type="button"
            className={cn(viewMode === 'grid' && 'is-active')}
            onClick={() => onViewModeChange('grid')}
            aria-label="Grid view"
          >
            <Grid className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={cn(viewMode === 'list' && 'is-active')}
            onClick={() => onViewModeChange('list')}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        <button type="button" className="library-v2-detail-play" onClick={onPlayAll}>
          <Play className="h-4 w-4" />
          Play all
        </button>
      </div>
    </header>
  );
});
