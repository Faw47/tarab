import { lazy, type MouseEvent, memo, Suspense } from 'react';
import { HomeView } from '../../components/home/HomeView';
import { HomeViewNeo } from '../../components/home/HomeViewNeo';
import type { NavView } from '../../components/navigation';
import type { useLibraryScan } from '../../components/settings/useLibraryScan';
import type { AppTheme, NavMode } from '../../store/settings-store';
import type { ContextMenuPosition, Track } from '../../types';
import type { useViewRouter } from './useViewRouter';

const UnifiedSettingsView = lazy(() =>
  import('../../components/settings/UnifiedSettingsView').then((mod) => ({
    default: mod.UnifiedSettingsView,
  })),
);

const TagManagerView = lazy(() =>
  import('../../components/tagmanager/TagManagerView').then((mod) => ({
    default: mod.TagManagerView,
  })),
);

const PlaylistsView = lazy(() =>
  import('../../components/playlist/PlaylistsView').then((mod) => ({
    default: mod.PlaylistsView,
  })),
);

const LibraryView = lazy(() =>
  import('../../components/library/LibraryView').then((mod) => ({
    default: mod.LibraryView,
  })),
);

const QueueView = lazy(() =>
  import('../../components/queue/QueueView').then((mod) => ({
    default: mod.QueueView,
  })),
);

const AlbumDetailsOverlay = lazy(() =>
  import('../../components/shared/AlbumDetailsOverlay').then((mod) => ({
    default: mod.AlbumDetailsOverlay,
  })),
);

const AlbumDetailsOverlayNeo = lazy(() =>
  import('../../components/shared/AlbumDetailsOverlayNeo').then((mod) => ({
    default: mod.AlbumDetailsOverlayNeo,
  })),
);

const viewFallback = (
  <div
    className="flex h-full flex-col gap-4 p-8 animate-fade-in"
    role="status"
    aria-label="Loading view"
  >
    <div className="h-8 w-48 rounded-lg skeleton-shimmer" />
    <div className="h-4 w-72 max-w-full rounded skeleton-shimmer" />
    <div className="min-h-0 flex-1 rounded-2xl skeleton-shimmer opacity-60" />
  </div>
);

type AlbumDetails = ReturnType<typeof useViewRouter>['albumDetails'];

export interface AppViewRendererProps {
  currentView: NavView;
  theme: AppTheme;
  navMode: NavMode;
  albumDetails: AlbumDetails;
  currentTrackId?: string;
  isPlaying: boolean;
  selectedTracks: Track[];
  initialLibraryLoading: boolean;
  libraryLoadError: string | null;
  libraryScan: ReturnType<typeof useLibraryScan>;
  onNavigate: (view: NavView) => void;
  onBack: () => void;
  onOpenAlbumDetails: (details: NonNullable<AlbumDetails>) => void;
  onOpenFullPlayer: () => void;
  onRetryLoad: () => void;
  onScrollChange: (isScrolled: boolean) => void;
  onTrackContextMenu: (track: Track, position: ContextMenuPosition) => void;
  onTrackSelect: (track: Track, isMulti: boolean) => void;
  onSelectionChange: (tracks: Track[]) => void;
  onSelectAllTracks: () => void;
  onClearSelection: () => void;
  onSetSelectedTracks: (tracks: Track[]) => void;
  onOpenTagEditor: (tracks: Track[]) => void;
  onOpenAlbumTagEditor: (tracks: Track[]) => void;
  onRevealTracks: (tracks: Track[]) => void;
  onCopyMetadata: (track: Track) => void | Promise<void>;
  onPasteMetadata: (tracks: Track[]) => void | Promise<void>;
  onRenameTrack: (track: Track, newName: string) => Promise<void>;
  onMoveTracks: (tracks: Track[], destination: string) => Promise<void>;
  onDeleteFiles: (tracks: Track[]) => void;
  onRemoveTracks: (tracks: Track[], options?: { updateAlbumView?: boolean }) => void;
  onRevealTrackInFinder: (track: Track) => void;
  onAddTracksToQueue: (tracks: Track[]) => void;
  onPlayAlbum: () => void;
  onPlayAlbumTrack: (track: Track) => void;
  onShuffleAlbum: () => void;
}

export const AppViewRenderer = memo(function AppViewRenderer({
  currentView,
  theme,
  navMode,
  albumDetails,
  currentTrackId,
  isPlaying,
  selectedTracks,
  initialLibraryLoading,
  libraryLoadError,
  libraryScan,
  onNavigate,
  onBack,
  onOpenAlbumDetails,
  onOpenFullPlayer,
  onRetryLoad,
  onScrollChange,
  onTrackContextMenu,
  onTrackSelect,
  onSelectionChange,
  onSelectAllTracks,
  onClearSelection,
  onSetSelectedTracks,
  onOpenTagEditor,
  onOpenAlbumTagEditor,
  onRevealTracks,
  onCopyMetadata,
  onPasteMetadata,
  onRenameTrack,
  onMoveTracks,
  onDeleteFiles,
  onRemoveTracks,
  onRevealTrackInFinder,
  onAddTracksToQueue,
  onPlayAlbum,
  onPlayAlbumTrack,
  onShuffleAlbum,
}: AppViewRendererProps) {
  const HomeViewComponent = theme === 'neobrutalism' ? HomeViewNeo : HomeView;
  const selectedTrackIds = selectedTracks.map((track) => track.id);
  const renderHomeView = () => (
    <HomeViewComponent
      onNavigateToLibrary={() => onNavigate('library')}
      onNavigateToFolders={() => onNavigate('settings')}
      onNavigateToQueue={() => onNavigate('queue')}
      onOpenAlbumDetails={onOpenAlbumDetails}
      onOpenFullPlayer={onOpenFullPlayer}
      isLibraryLoading={initialLibraryLoading}
      libraryError={libraryLoadError}
      onRetryLoad={onRetryLoad}
      onScrollChange={onScrollChange}
    />
  );

  switch (currentView) {
    case 'home':
      return renderHomeView();
    case 'library':
    case 'search':
      return (
        <Suspense fallback={viewFallback}>
          <LibraryView
            onTrackContextMenu={onTrackContextMenu}
            onTrackSelect={onTrackSelect}
            selectedTrackIds={selectedTrackIds}
            onOpenTagEditor={onOpenTagEditor}
            onSelectAll={onSelectAllTracks}
            onClearSelection={onClearSelection}
            onOpenAlbumDetails={onOpenAlbumDetails}
            isLibraryLoading={initialLibraryLoading}
            libraryError={libraryLoadError}
            onRetryLoad={onRetryLoad}
            onNavigateToFolders={() => onNavigate('settings')}
            onScrollChange={onScrollChange}
            iconRailLayout={navMode === 'iconRail' && theme !== 'neobrutalism'}
          />
        </Suspense>
      );
    case 'queue':
      return (
        <Suspense fallback={viewFallback}>
          <QueueView
            isLibraryLoading={initialLibraryLoading}
            libraryError={libraryLoadError}
            onRetryLoad={onRetryLoad}
            onScrollChange={onScrollChange}
          />
        </Suspense>
      );
    case 'playlists':
      return (
        <Suspense fallback={viewFallback}>
          <PlaylistsView />
        </Suspense>
      );
    case 'tags':
      return (
        <Suspense fallback={viewFallback}>
          <TagManagerView
            selectedTracks={selectedTracks}
            onSelectionChange={onSelectionChange}
            onToggleTrack={onTrackSelect}
            onOpenTagEditor={onOpenTagEditor}
            onRevealFiles={onRevealTracks}
            onCopyMetadata={onCopyMetadata}
            onPasteMetadata={onPasteMetadata}
            onTrackContextMenu={onTrackContextMenu}
            onRenameTrack={onRenameTrack}
            onMoveTracks={onMoveTracks}
            onDeleteFiles={onDeleteFiles}
            onRemoveTracks={onRemoveTracks}
            onScrollChange={onScrollChange}
          />
        </Suspense>
      );
    case 'settings':
      return (
        <Suspense fallback={viewFallback}>
          <UnifiedSettingsView onScrollChange={onScrollChange} libraryScan={libraryScan} />
        </Suspense>
      );
    case 'album': {
      if (!albumDetails) return renderHomeView();
      const AlbumOverlayComponent =
        theme === 'neobrutalism' ? AlbumDetailsOverlayNeo : AlbumDetailsOverlay;
      return (
        <Suspense fallback={viewFallback}>
          <AlbumOverlayComponent
            album={albumDetails.album}
            artist={albumDetails.artist}
            coverArt={albumDetails.coverArt}
            tracks={albumDetails.tracks}
            onClose={onBack}
            onPlayAlbum={onPlayAlbum}
            onPlayTrack={onPlayAlbumTrack}
            onTrackContextMenu={(event: MouseEvent, track: Track) => {
              onTrackContextMenu(track, { x: event.clientX, y: event.clientY });
            }}
            selectedTrackIds={selectedTrackIds}
            onTrackSelect={onTrackSelect}
            onClearSelection={onClearSelection}
            onSelectAll={onSetSelectedTracks}
            onOpenTagEditor={onOpenAlbumTagEditor}
            onAddToQueue={onAddTracksToQueue}
            onRevealInFinder={onRevealTrackInFinder}
            onDeleteTracks={(tracks) => onRemoveTracks(tracks, { updateAlbumView: true })}
            onShuffleAlbum={onShuffleAlbum}
            currentlyPlayingId={currentTrackId}
            isPlaying={isPlaying}
            onScrollChange={onScrollChange}
          />
        </Suspense>
      );
    }
    default:
      return renderHomeView();
  }
});
