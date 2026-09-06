import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';

const { mocks, fetchAlbumTracksMock, fetchArtistTracksMock, setSearchScopeMock, settingsState } =
  vi.hoisted(() => ({
    mocks: {
      tracks: [] as Track[],
      filteredTracks: null as Track[] | null,
      searchQuery: '',
      searchScope: 'all' as 'all' | 'tracks' | 'albums' | 'artists' | 'lyrics',
      searchError: null as string | null,
      retrySearch: vi.fn(async () => undefined),
      isSearching: false,
      recentTracks: [] as Track[],
      mostPlayedTracks: [] as Track[],
      trackCount: 0,
      loadMoreTracks: vi.fn(async () => ({
        tracks: [] as Track[],
        restarted: false,
        hasMore: false,
      })),
    },
    settingsState: {
      downloadArtwork: false,
      reducedEffects: true,
      backgroundEnabled: true,
      theme: 'dark' as string,
      debugLiquidControlGlass: false,
    },
    fetchAlbumTracksMock: vi.fn(),
    fetchArtistTracksMock: vi.fn(),
    setSearchScopeMock: vi.fn(),
  }));

const makeTrack = (
  id: string,
  album: string,
  artist: string,
  overrides: Partial<Track> = {},
): Track => ({
  id,
  title: `${album} song`,
  artist,
  albumArtist: null,
  album,
  year: 2026,
  duration: 180,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: true,
  coverArtHash: null,
  dateAdded: Date.now(),
  rating: null,
  ...overrides,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const motionState = vi.hoisted(() => ({ enabled: [] as boolean[] }));

vi.mock('../../../hooks/use-liquid-control-motion', () => ({
  useLiquidControlMotionHorizontal: ({ enabled }: { enabled: boolean }) => {
    motionState.enabled.push(enabled);
  },
}));

vi.mock('../../../store/settings-store', () => {
  const useSettingsStore = (selector: (value: typeof settingsState) => unknown) =>
    selector(settingsState);
  useSettingsStore.getState = () => settingsState;
  return { useSettingsStore };
});

vi.mock('../../../store/player-store', () => ({
  usePlayerStore: (selector: (state: { currentTrack: null; isPlaying: boolean }) => unknown) =>
    selector({ currentTrack: null, isPlaying: false }),
}));

vi.mock('../../../features/library/useLibraryData', () => ({
  useLibraryData: () => ({
    searchQuery: mocks.searchQuery,
    searchError: mocks.searchError,
    retrySearch: mocks.retrySearch,
    isSearching: mocks.isSearching,
    sortBy: 'dateAdded',
    libraryStats: null,
    recentTracks: mocks.recentTracks,
    mostPlayedTracks: mocks.mostPlayedTracks,
    searchScope: mocks.searchScope,
    setSearchScope: setSearchScopeMock,
    setSortBy: vi.fn(),
    getFilteredTracks: () => mocks.filteredTracks ?? mocks.tracks,
    trackCount: mocks.trackCount || mocks.tracks.length,
    tracks: mocks.tracks,
    loadMoreTracks: mocks.loadMoreTracks,
    applyCoverArtHashes: vi.fn(),
    isLyricsMatch: () => false,
    getLyricsMatchLine: () => null,
  }),
}));

vi.mock('../../../hooks/useCoverArt', () => ({
  useCoverArt: () => null,
  prefetchCoverArtBatch: vi.fn(async () => undefined),
}));

vi.mock('../../../hooks/useDominantColor', () => ({
  useDominantColor: () => null,
}));

vi.mock('../../../features/library/api', () => ({
  fetchLibraryTracksPage: vi.fn(async () => []),
  fetchAlbumTracks: fetchAlbumTracksMock,
  fetchArtistTracks: fetchArtistTracksMock,
}));

vi.mock('../../../lib/tauri-commands', () => ({
  generateCoverArtHashes: vi.fn(async () => []),
}));

vi.mock('../../../lib/playback-actions', () => ({
  startPlayback: vi.fn(),
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: vi.fn(),
}));

vi.mock('../../shared/VirtualizedList', () => ({
  VirtualizedList: ({
    items,
    renderItem,
  }: {
    items: unknown[];
    renderItem: (item: unknown, index: number) => ReactNode;
  }) => <>{items.map((item, index) => renderItem(item, index))}</>,
}));

vi.mock('../LibraryTracksList', () => ({
  LibraryTracksList: ({
    tracks,
    onShowFileInfo,
  }: {
    tracks: Track[];
    onShowFileInfo: (track: Track) => void;
  }) => (
    <>
      {tracks.map((track) => (
        <button key={track.id} type="button" onClick={() => onShowFileInfo(track)}>
          Open info for {track.title}
        </button>
      ))}
    </>
  ),
}));

import { LibraryView } from '../LibraryView';

describe('LibraryView', () => {
  beforeEach(() => {
    mocks.tracks = [];
    mocks.filteredTracks = null;
    mocks.searchQuery = '';
    mocks.searchScope = 'all';
    mocks.searchError = null;
    mocks.retrySearch.mockReset();
    mocks.retrySearch.mockResolvedValue(undefined);
    mocks.isSearching = false;
    mocks.recentTracks = [];
    mocks.mostPlayedTracks = [];
    mocks.trackCount = 0;
    mocks.loadMoreTracks.mockReset();
    mocks.loadMoreTracks.mockResolvedValue({
      tracks: [],
      restarted: false,
      hasMore: false,
    });
    settingsState.theme = 'dark';
    settingsState.reducedEffects = true;
    settingsState.backgroundEnabled = true;
    motionState.enabled = [];
    fetchAlbumTracksMock.mockReset();
    fetchAlbumTracksMock.mockResolvedValue([]);
    fetchArtistTracksMock.mockReset();
    fetchArtistTracksMock.mockResolvedValue([]);
    setSearchScopeMock.mockReset();
  });

  it('renders empty library state when there are no tracks', () => {
    render(<LibraryView selectedTrackIds={[]} />);

    expect(screen.getByText('No music yet')).toBeInTheDocument();
  });

  it('disables GPU pill motion when reduced effects are active', () => {
    render(<LibraryView selectedTrackIds={[]} />);

    expect(motionState.enabled.length).toBeGreaterThan(0);
    expect(motionState.enabled.every((enabled) => enabled === false)).toBe(true);
  });

  it('disables GPU pill motion when the background is disabled', () => {
    settingsState.reducedEffects = false;
    settingsState.backgroundEnabled = false;
    render(<LibraryView selectedTrackIds={[]} />);

    expect(motionState.enabled.length).toBeGreaterThan(0);
    expect(motionState.enabled.every((enabled) => enabled === false)).toBe(true);
  });

  it('routes true empty libraries to folder setup', () => {
    const onNavigateToFolders = vi.fn();
    render(<LibraryView selectedTrackIds={[]} onNavigateToFolders={onNavigateToFolders} />);

    fireEvent.click(screen.getByRole('button', { name: /add folders/i }));

    expect(onNavigateToFolders).toHaveBeenCalledTimes(1);
  });

  it('does not paginate the backing library while a search is active', () => {
    const track = makeTrack('search', 'Search record', 'Search artist');
    mocks.tracks = [track];
    mocks.filteredTracks = [track];
    mocks.searchQuery = 'search';
    mocks.trackCount = 10;

    render(<LibraryView selectedTrackIds={[]} />);

    const root = document.querySelector('.library-v2-root');
    expect(root).not.toBeNull();
    Object.defineProperties(root, {
      scrollTop: { configurable: true, value: 90 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 100 },
    });
    fireEvent.scroll(root!);

    expect(mocks.loadMoreTracks).not.toHaveBeenCalled();
  });

  it('stops retrying a failed incremental load and offers an explicit retry', async () => {
    const track = makeTrack('load-more-failure', 'Load more record', 'Load more artist');
    mocks.tracks = [track];
    mocks.filteredTracks = [track];
    mocks.trackCount = 10;
    mocks.loadMoreTracks
      .mockRejectedValueOnce(new Error('Cursor unavailable'))
      .mockResolvedValue({ tracks: [track], restarted: false, hasMore: false });

    render(<LibraryView selectedTrackIds={[]} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Songs/ }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: /Songs/ }));

    const root = document.querySelector('.library-v2-root');
    expect(root).not.toBeNull();
    Object.defineProperties(root, {
      scrollTop: { configurable: true, value: 90 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 100 },
    });

    fireEvent.scroll(root!);
    await waitFor(() => expect(mocks.loadMoreTracks).toHaveBeenCalledOnce());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load more library tracks.',
    );

    fireEvent.scroll(root!);
    expect(mocks.loadMoreTracks).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading more tracks' }));
    await waitFor(() => expect(mocks.loadMoreTracks).toHaveBeenCalledTimes(2));
  });
  it('shows an actionable search error when the backend is unavailable', async () => {
    mocks.searchQuery = 'missing';
    mocks.searchError = 'Search index unavailable';

    render(<LibraryView selectedTrackIds={[]} />);

    expect(screen.getByRole('heading', { name: 'Search unavailable' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    await waitFor(() => expect(mocks.retrySearch).toHaveBeenCalledOnce());
  });

  it('shows the same actionable search error in Neo mode', async () => {
    settingsState.theme = 'neobrutalism';
    mocks.searchQuery = 'missing';
    mocks.searchError = 'Search index unavailable';

    render(<LibraryView selectedTrackIds={[]} />);

    expect(screen.getByText('SEARCH UNAVAILABLE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    await waitFor(() => expect(mocks.retrySearch).toHaveBeenCalledOnce());
  });

  it('does not paginate aggregate facets that already represent the full library', () => {
    const track = makeTrack('album', 'Album record', 'Album artist');
    mocks.tracks = [track];
    mocks.trackCount = 10;

    render(<LibraryView selectedTrackIds={[]} />);

    const root = document.querySelector('.library-v2-root');
    expect(root).not.toBeNull();
    Object.defineProperties(root, {
      scrollTop: { configurable: true, value: 90 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 100 },
    });
    fireEvent.scroll(root!);

    expect(mocks.loadMoreTracks).not.toHaveBeenCalled();
  });

  it('does not paginate the backing library while a detail scope is open', async () => {
    const track = makeTrack('detail', 'Detail record', 'Detail artist');
    mocks.tracks = [track];
    mocks.trackCount = 10;
    fetchAlbumTracksMock.mockResolvedValue([track]);

    render(<LibraryView selectedTrackIds={[]} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open album Detail record by Detail artist' }),
    );
    await screen.findByText('1 track in focus');

    const root = document.querySelector('.library-v2-root');
    expect(root).not.toBeNull();
    Object.defineProperties(root, {
      scrollTop: { configurable: true, value: 90 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 100 },
    });
    fireEvent.scroll(root!);

    expect(mocks.loadMoreTracks).not.toHaveBeenCalled();
  });

  it('uses Neo surfaces for library loading and error states', () => {
    settingsState.theme = 'neobrutalism';
    const onRetryLoad = vi.fn();
    const { rerender } = render(
      <LibraryView selectedTrackIds={[]} isLibraryLoading onRetryLoad={onRetryLoad} />,
    );

    const loadingStatus = screen.getByRole('status', { name: 'Loading library' });
    expect(loadingStatus).toHaveClass('library-neo-loading-shell');
    expect(loadingStatus.parentElement).toHaveClass('library-neo-state-wrap');

    rerender(
      <LibraryView
        selectedTrackIds={[]}
        libraryError="Database unavailable"
        onRetryLoad={onRetryLoad}
      />,
    );

    const errorHeading = screen.getByRole('heading', { name: 'Could not load library' });
    expect(errorHeading.parentElement).toHaveClass('library-neo-error-shell');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryLoad).toHaveBeenCalledOnce();
  });
  it('keeps Neo batch tag editing available for selected files', () => {
    settingsState.theme = 'neobrutalism';
    const track = makeTrack('neo-selected', 'Neo record', 'Neo artist');
    mocks.tracks = [track];
    const onOpenTagEditor = vi.fn();

    render(<LibraryView selectedTrackIds={[track.id]} onOpenTagEditor={onOpenTagEditor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit 1 selected' }));
    expect(onOpenTagEditor).toHaveBeenCalledWith([track]);
  });

  it('routes the Neo empty-library action to folder setup', () => {
    settingsState.theme = 'neobrutalism';
    const onNavigateToFolders = vi.fn();

    render(<LibraryView selectedTrackIds={[]} onNavigateToFolders={onNavigateToFolders} />);

    fireEvent.click(screen.getByRole('button', { name: 'MAP FOLDERS' }));
    expect(onNavigateToFolders).toHaveBeenCalledOnce();
  });

  it('exposes scoped search controls in the Neo library', () => {
    settingsState.theme = 'neobrutalism';
    mocks.tracks = [makeTrack('scope', 'Scope record', 'Scope artist')];

    render(<LibraryView selectedTrackIds={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search scope' }), {
      target: { value: 'lyrics' },
    });

    expect(setSearchScopeMock).toHaveBeenCalledWith('lyrics');
  });

  it('explains the minimum lyric search length in Neo mode', () => {
    settingsState.theme = 'neobrutalism';
    mocks.searchQuery = 'ab';
    mocks.searchScope = 'lyrics';

    render(<LibraryView selectedTrackIds={[]} />);

    expect(screen.getByText('TYPE AT LEAST 3 CHARACTERS TO SEARCH LYRICS.')).toBeInTheDocument();
  });
  it('restores the featured-first album showcase', () => {
    mocks.tracks = [
      makeTrack('lead', 'Featured record', 'Lead artist'),
      makeTrack('second', 'Second record', 'Second artist'),
    ];

    render(<LibraryView selectedTrackIds={[]} />);

    const showcase = screen.getByRole('group', { name: 'Featured albums' });
    expect(showcase).toBeInTheDocument();
    expect(screen.getByText('Featured album').closest('article')).toHaveClass(
      'library-v2-album-featured-span',
    );
    expect(screen.getByText('Second record')).toBeInTheDocument();
  });

  it('selects only the current filtered result set', () => {
    const visible = makeTrack('visible', 'Visible record', 'Visible artist');
    const hidden = makeTrack('hidden', 'Hidden record', 'Hidden artist');
    mocks.tracks = [visible, hidden];
    mocks.filteredTracks = [visible];
    mocks.searchQuery = 'visible';
    const onSelectAll = vi.fn();

    render(
      <LibraryView
        selectedTrackIds={[visible.id]}
        onSelectAll={onSelectAll}
        onClearSelection={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));

    expect(onSelectAll).toHaveBeenCalledWith([visible]);
  });

  it('selects the active facet result set', () => {
    const recent = makeTrack('recent', 'Recent record', 'Recent artist');
    const older = makeTrack('older', 'Older record', 'Older artist');
    mocks.tracks = [recent, older];
    mocks.recentTracks = [recent];
    const onSelectAll = vi.fn();

    render(
      <LibraryView
        selectedTrackIds={[recent.id]}
        onSelectAll={onSelectAll}
        onClearSelection={vi.fn()}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recent/ }), { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));

    expect(onSelectAll).toHaveBeenCalledWith([recent]);
  });

  it('selects tracks loaded for the current detail result', async () => {
    const summary = makeTrack('summary', 'Summary record', 'Detail artist');
    const detailTracks = [
      makeTrack('detail-1', 'Summary record', 'Detail artist'),
      makeTrack('detail-2', 'Summary record', 'Detail artist'),
    ];
    mocks.tracks = [summary];
    fetchAlbumTracksMock.mockResolvedValue(detailTracks);
    const onSelectAll = vi.fn();

    render(
      <LibraryView
        selectedTrackIds={[detailTracks[0].id]}
        onSelectAll={onSelectAll}
        onClearSelection={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open album Summary record by Detail artist' }),
    );
    await waitFor(() =>
      expect(fetchAlbumTracksMock).toHaveBeenCalledWith('Summary record', 'Detail artist'),
    );
    await screen.findByText('2 tracks in focus');
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));

    expect(onSelectAll).toHaveBeenCalledWith(detailTracks);
  });

  it('keeps album cards delegated to the App-level album overlay', async () => {
    const lead = makeTrack('lead', 'Overlay record', 'Overlay artist');
    const albumTracks = [lead, makeTrack('second', 'Overlay record', 'Overlay artist')];
    mocks.tracks = [lead];
    fetchAlbumTracksMock.mockResolvedValue(albumTracks);
    const onOpenAlbumDetails = vi.fn();

    render(<LibraryView selectedTrackIds={[]} onOpenAlbumDetails={onOpenAlbumDetails} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open album Overlay record by Overlay artist' }),
    );

    await waitFor(() =>
      expect(onOpenAlbumDetails).toHaveBeenCalledWith({
        album: 'Overlay record',
        artist: 'Overlay artist',
        coverArt: undefined,
        tracks: albumTracks,
      }),
    );
  });

  it('does not double-open an album when its keyboard action is activated', async () => {
    const lead = makeTrack('keyboard-album', 'Keyboard record', 'Keyboard artist');
    mocks.tracks = [lead];
    fetchAlbumTracksMock.mockResolvedValue([lead]);
    const onOpenAlbumDetails = vi.fn();

    render(<LibraryView selectedTrackIds={[]} onOpenAlbumDetails={onOpenAlbumDetails} />);
    const openButton = screen.getByRole('button', {
      name: 'Open album Keyboard record by Keyboard artist',
    });

    fireEvent.keyDown(openButton, { key: 'Enter' });
    fireEvent.click(openButton);

    await waitFor(() => expect(onOpenAlbumDetails).toHaveBeenCalledTimes(1));
  });
  it('ignores an older album request that resolves after a newer album', async () => {
    const first = makeTrack('first', 'First record', 'First artist');
    const second = makeTrack('second', 'Second record', 'Second artist');
    const firstRequest = deferred<Track[]>();
    const secondRequest = deferred<Track[]>();
    mocks.tracks = [first, second];
    fetchAlbumTracksMock.mockImplementation((album: string) =>
      album === first.album ? firstRequest.promise : secondRequest.promise,
    );
    const onOpenAlbumDetails = vi.fn();

    render(<LibraryView selectedTrackIds={[]} onOpenAlbumDetails={onOpenAlbumDetails} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open album First record by First artist' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open album Second record by Second artist' }),
    );

    await act(async () => {
      secondRequest.resolve([second]);
      await secondRequest.promise;
    });
    await waitFor(() => expect(onOpenAlbumDetails).toHaveBeenCalledTimes(1));
    expect(onOpenAlbumDetails).toHaveBeenLastCalledWith(
      expect.objectContaining({ album: second.album, tracks: [second] }),
    );

    await act(async () => {
      firstRequest.resolve([first]);
      await firstRequest.promise;
    });
    expect(onOpenAlbumDetails).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest artist detail when requests resolve out of order', async () => {
    const first = makeTrack('first', 'First record', 'First artist');
    const second = makeTrack('second', 'Second record', 'Second artist');
    const firstRequest = deferred<Track[]>();
    const secondRequest = deferred<Track[]>();
    mocks.tracks = [first, second];
    fetchArtistTracksMock.mockImplementation((artist: string) =>
      artist === first.artist ? firstRequest.promise : secondRequest.promise,
    );

    render(<LibraryView selectedTrackIds={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Artists/ }), { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Open artist First artist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open artist Second artist' }));

    await act(async () => {
      secondRequest.resolve([second]);
      await secondRequest.promise;
    });
    expect(await screen.findByRole('heading', { name: 'Second artist' })).toBeInTheDocument();

    await act(async () => {
      firstRequest.resolve([first]);
      await firstRequest.promise;
    });
    expect(screen.queryByRole('heading', { name: 'First artist' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Second artist' })).toBeInTheDocument();
  });

  it('returns from local artist detail without changing browser history', async () => {
    const track = makeTrack('artist-detail', 'Artist record', 'Artist detail');
    mocks.tracks = [track];
    fetchArtistTracksMock.mockResolvedValue([track]);
    const historyBack = vi.spyOn(window.history, 'back');

    try {
      render(<LibraryView selectedTrackIds={[]} />);
      fireEvent.click(screen.getByRole('button', { name: 'List view' }));
      fireEvent.mouseDown(screen.getByRole('tab', { name: /Artists/ }), { button: 0 });
      fireEvent.click(screen.getByRole('button', { name: 'Open artist Artist detail' }));

      await screen.findByRole('heading', { name: 'Artist detail' });
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Artist detail' })).not.toBeInTheDocument(),
      );
      expect(historyBack).not.toHaveBeenCalled();
    } finally {
      historyBack.mockRestore();
    }
  });

  it('does not open album detail after the library unmounts', async () => {
    const track = makeTrack('pending', 'Pending record', 'Pending artist');
    const request = deferred<Track[]>();
    mocks.tracks = [track];
    fetchAlbumTracksMock.mockReturnValue(request.promise);
    const onOpenAlbumDetails = vi.fn();
    const { unmount } = render(
      <LibraryView selectedTrackIds={[]} onOpenAlbumDetails={onOpenAlbumDetails} />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Open album Pending record by Pending artist' }),
    );
    unmount();
    await act(async () => {
      request.resolve([track]);
      await request.promise;
    });

    expect(onOpenAlbumDetails).not.toHaveBeenCalled();
  });

  it('clears hidden selection when the result scope changes', async () => {
    const selected = makeTrack('selected', 'Selected record', 'Selected artist');
    const recent = makeTrack('recent', 'Recent record', 'Recent artist');
    mocks.tracks = [selected, recent];
    mocks.recentTracks = [recent];
    const onClearSelection = vi.fn();

    render(<LibraryView selectedTrackIds={[selected.id]} onClearSelection={onClearSelection} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recent/ }), { button: 0 });

    await waitFor(() => expect(onClearSelection).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Edit tags' })).toBeDisabled();
  });

  it('opens toolbar tag editing with the hydrated search result object', () => {
    const pagedTrack = makeTrack('paged', 'Paged record', 'Paged artist');
    const searchTrack = makeTrack('search-only', 'Search record', 'Search artist', {
      filePath: '/hydrated/search-only.flac',
      fileFormat: 'flac',
      bitrate: 1411,
    });
    mocks.tracks = [pagedTrack];
    mocks.filteredTracks = [searchTrack];
    mocks.searchQuery = 'Search record';
    const onOpenTagEditor = vi.fn();

    render(<LibraryView selectedTrackIds={[searchTrack.id]} onOpenTagEditor={onOpenTagEditor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit 1 selected' }));

    expect(onOpenTagEditor).toHaveBeenCalledWith([searchTrack]);
  });

  it('opens toolbar tag editing with a hydrated facet track outside the paged cache', () => {
    const pagedTrack = makeTrack('paged', 'Paged record', 'Paged artist');
    const recentTrack = makeTrack('recent-only', 'Recent record', 'Recent artist', {
      filePath: '/hydrated/recent-only.flac',
      fileFormat: 'flac',
    });
    mocks.tracks = [pagedTrack];
    mocks.recentTracks = [recentTrack];
    const onOpenTagEditor = vi.fn();

    render(<LibraryView selectedTrackIds={[recentTrack.id]} onOpenTagEditor={onOpenTagEditor} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recent/ }), { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Edit 1 selected' }));

    expect(onOpenTagEditor).toHaveBeenCalledWith([recentTrack]);
  });

  it('uses the clicked hydrated search result for file info and tag editing', async () => {
    const pagedTrack = makeTrack('paged', 'Paged record', 'Paged artist');
    const searchTrack = makeTrack('search-info', 'Hydrated result', 'Search artist', {
      title: 'Hydrated result',
      filePath: '/hydrated/search-info.flac',
      fileFormat: 'flac',
      bitrate: 1411,
      sampleRate: 96_000,
      fileSize: 4_096,
    });
    mocks.tracks = [pagedTrack];
    mocks.filteredTracks = [searchTrack];
    mocks.searchQuery = 'Hydrated result';
    const onOpenTagEditor = vi.fn();

    render(<LibraryView selectedTrackIds={[]} onOpenTagEditor={onOpenTagEditor} />);
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open info for Hydrated result' }));

    expect(screen.getByText('/hydrated/search-info.flac')).toBeInTheDocument();
    expect(screen.getByText('1411 kbps')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'File properties' })).getByRole('button', {
        name: 'Edit tags',
      }),
    );
    expect(onOpenTagEditor).toHaveBeenCalledWith([searchTrack]);
  });

  it('uses the clicked hydrated detail track outside the paged cache', async () => {
    const summary = makeTrack('summary', 'Detail record', 'Detail artist');
    const detailTrack = makeTrack('detail-only', 'Detail-only song', 'Detail artist', {
      title: 'Detail-only song',
      filePath: '/hydrated/detail-only.flac',
      fileFormat: 'flac',
      bitrate: 900,
    });
    mocks.tracks = [summary];
    fetchAlbumTracksMock.mockResolvedValue([detailTrack]);
    const onOpenTagEditor = vi.fn();

    render(<LibraryView selectedTrackIds={[]} onOpenTagEditor={onOpenTagEditor} />);
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open album Detail record' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open info for Detail-only song' }));

    expect(screen.getByText('/hydrated/detail-only.flac')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'File properties' })).getByRole('button', {
        name: 'Edit tags',
      }),
    );
    expect(onOpenTagEditor).toHaveBeenCalledWith([detailTrack]);
  });
});
