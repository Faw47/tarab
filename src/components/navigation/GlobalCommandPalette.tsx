import { Command } from 'cmdk';
import {
  Home,
  Library,
  ListMusic,
  type LucideIcon,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Tag,
  TerminalSquare,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { fetchLibrarySearch } from '@/features/library/api';
import {
  getCommandPaletteShortcutLabel,
  getDirectionalShortcutLabel,
  isApplePlatform,
} from '@/lib/platform-shortcuts';
import { cn } from '@/lib/utils';
import type { Track } from '@/types';
import { reportError } from '../../lib/report-error';
import type { AppTheme } from '../../store/settings-store';
import type { NavView } from './FloatingDock';

interface GlobalCommandPaletteProps {
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  onShuffleAll: () => void;
  onTogglePlayback: () => Promise<void>;
  onNextTrack: () => Promise<void>;
  onPreviousTrack: () => Promise<void>;
  onRescanLibrary: () => Promise<void>;
  onOpenFullPlayer: () => void;
  hasCurrentTrack: boolean;
  isPlaying: boolean;
  isScanning: boolean;
  theme: AppTheme;
  onPlaySearchResult: (track: Track, results: Track[]) => Promise<void>;
  onOpenLibrarySearch: (query: string) => void;
}

interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  group: 'Navigation' | 'Playback' | 'Library';
  icon: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void | Promise<void>;
}

export const GlobalCommandPalette = memo(function GlobalCommandPalette({
  currentView,
  onNavigate,
  onShuffleAll,
  onTogglePlayback,
  onNextTrack,
  onPreviousTrack,
  onRescanLibrary,
  onOpenFullPlayer,
  hasCurrentTrack,
  isPlaying,
  isScanning,
  theme,
  onPlaySearchResult,
  onOpenLibrarySearch,
}: GlobalCommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearchingLibrary, setIsSearchingLibrary] = useState(false);
  const [librarySearchFailed, setLibrarySearchFailed] = useState(false);
  const isNeo = theme === 'neobrutalism';
  const isMac = isApplePlatform();
  const paletteShortcut = getCommandPaletteShortcutLabel(isMac);
  const searchTerm = query.trim();

  const runAndClose = useCallback((runner: () => void | Promise<void>) => {
    setOpen(false);
    setQuery('');
    void Promise.resolve(runner()).catch((error) =>
      reportError('That command could not finish', {
        source: 'command-palette',
        error,
      }),
    );
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const isModK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isModK) {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }

      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const handleNativeOpen = () => setOpen(true);
    window.addEventListener('tarab:open-command-palette', handleNativeOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('tarab:open-command-palette', handleNativeOpen);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    let active = true;
    if (!open || searchTerm.length < 2) {
      setSearchResults([]);
      setIsSearchingLibrary(false);
      setLibrarySearchFailed(false);
      return () => {
        active = false;
      };
    }

    setSearchResults([]);
    setIsSearchingLibrary(true);
    setLibrarySearchFailed(false);

    const timeout = setTimeout(() => {
      void fetchLibrarySearch(searchTerm, 24, {
        includeMetadata: true,
        includeLyrics: false,
      })
        .then(({ metadata }) => {
          if (!active) return;
          setSearchResults(metadata);
        })
        .catch((error) => {
          if (!active) return;
          setSearchResults([]);
          setLibrarySearchFailed(true);
          reportError('Library search failed', {
            source: 'command-palette',
            error,
          });
        })
        .finally(() => {
          if (active) setIsSearchingLibrary(false);
        });
    }, 160);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [open, searchTerm]);

  const albumResults = useMemo(() => {
    const albums = new Map<string, { album: string; artist: string; count: number }>();

    for (const track of searchResults) {
      const album = track.album.trim();
      if (!album) continue;
      const artist = (track.albumArtist || track.artist).trim();
      const key = `${album.toLocaleLowerCase()}\u0000${artist.toLocaleLowerCase()}`;
      const existing = albums.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        albums.set(key, { album, artist, count: 1 });
      }
    }

    return Array.from(albums.values()).slice(0, 8);
  }, [searchResults]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'nav-home',
        label: 'Go to Home',
        description: 'Open the home dashboard',
        group: 'Navigation',
        icon: Home,
        disabled: currentView === 'home',
        disabledReason: 'Home is already open.',
        onSelect: () => onNavigate('home'),
      },
      {
        id: 'nav-library',
        label: 'Go to Library',
        description: 'Browse your full music library',
        group: 'Navigation',
        icon: Library,
        disabled: currentView === 'library',
        disabledReason: 'Library is already open.',
        onSelect: () => onNavigate('library'),
      },
      {
        id: 'nav-queue',
        label: 'Go to Queue',
        description: 'View and reorder up next tracks',
        group: 'Navigation',
        icon: ListMusic,
        disabled: currentView === 'queue',
        disabledReason: 'Queue is already open.',
        onSelect: () => onNavigate('queue'),
      },
      {
        id: 'nav-playlists',
        label: 'Go to Playlists',
        description: 'Open manual, smart, and synced playlists',
        group: 'Navigation',
        icon: ListMusic,
        disabled: currentView === 'playlists',
        disabledReason: 'Playlists is already open.',
        onSelect: () => onNavigate('playlists'),
      },
      {
        id: 'nav-tags',
        label: 'Go to Tags',
        description: 'Edit metadata and tag fields',
        group: 'Navigation',
        icon: Tag,
        disabled: currentView === 'tags',
        disabledReason: 'Tags is already open.',
        onSelect: () => onNavigate('tags'),
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        description: 'Open app preferences and options',
        group: 'Navigation',
        icon: Settings,
        disabled: currentView === 'settings',
        disabledReason: 'Settings is already open.',
        onSelect: () => onNavigate('settings'),
      },
      {
        id: 'play-toggle',
        label: isPlaying ? 'Pause Playback' : 'Resume Playback',
        description: 'Toggle current playback state',
        group: 'Playback',
        icon: isPlaying ? Pause : Play,
        shortcut: 'Space',
        disabled: !hasCurrentTrack,
        disabledReason: 'Select a track before you use playback controls.',
        onSelect: onTogglePlayback,
      },
      {
        id: 'play-next',
        label: 'Next Track',
        description: 'Skip forward in the queue',
        group: 'Playback',
        icon: SkipForward,
        shortcut: getDirectionalShortcutLabel('next', isMac),
        disabled: !hasCurrentTrack,
        disabledReason: 'Select a track before you skip.',
        onSelect: onNextTrack,
      },
      {
        id: 'play-previous',
        label: 'Previous Track',
        description: 'Go to previous track or restart current',
        group: 'Playback',
        icon: SkipBack,
        shortcut: getDirectionalShortcutLabel('previous', isMac),
        disabled: !hasCurrentTrack,
        disabledReason: 'Select a track before you go back.',
        onSelect: onPreviousTrack,
      },
      {
        id: 'play-full-player',
        label: 'Open Full Player',
        description: 'Expand to full player view',
        group: 'Playback',
        icon: Maximize2,
        shortcut: 'F',
        disabled: !hasCurrentTrack,
        disabledReason: 'Select a track before you open the full player.',
        onSelect: onOpenFullPlayer,
      },
      {
        id: 'library-search',
        label: searchTerm ? `Search Library for "${searchTerm}"` : 'Search Tracks and Albums',
        description: 'Search track titles, artists, and album names',
        group: 'Library',
        icon: Library,
        disabled: searchTerm.length === 0,
        disabledReason: 'Type a search term to look through your library.',
        onSelect: () => onOpenLibrarySearch(searchTerm),
      },
      {
        id: 'library-shuffle',
        label: 'Shuffle All Tracks',
        description: 'Randomize and start playback from the full library',
        group: 'Library',
        icon: Shuffle,
        onSelect: () => onShuffleAll(),
      },
      {
        id: 'library-rescan',
        label: isScanning ? 'Library Rescan Running…' : 'Rescan Library',
        description: 'Refresh all library folders and metadata',
        group: 'Library',
        icon: RefreshCw,
        disabled: isScanning,
        disabledReason: 'A library scan is already running.',
        onSelect: onRescanLibrary,
      },
    ],
    [
      currentView,
      searchTerm,
      isMac,
      hasCurrentTrack,
      isPlaying,
      isScanning,
      onNavigate,
      onOpenLibrarySearch,
      onNextTrack,
      onOpenFullPlayer,
      onPreviousTrack,
      onRescanLibrary,
      onShuffleAll,
      onTogglePlayback,
    ],
  );

  const grouped = useMemo(
    () => ({
      Navigation: commands.filter((command) => command.group === 'Navigation'),
      Playback: commands.filter((command) => command.group === 'Playback'),
      Library: commands.filter((command) => command.group === 'Library'),
    }),
    [commands],
  );

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'top-[10vh] max-h-[80vh] w-[calc(100%-2rem)] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0',
          isNeo
            ? 'border-3 border-black bg-white shadow-[12px_12px_0_0_#000]'
            : 'rounded-2xl border border-white/10 bg-[#0f1118]/95 shadow-2xl',
        )}
      >
        <DialogTitle className="sr-only">Global commands</DialogTitle>
        <Command label="Global commands" loop className="w-full">
          <div
            className={cn(
              'flex items-center gap-3 border-b px-4 py-3',
              isNeo ? 'border-black' : 'border-white/10',
            )}
          >
            <TerminalSquare
              className={cn('h-5 w-5 shrink-0', isNeo ? 'text-black' : 'text-white/70')}
            />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search commands, tracks, albums…"
              className={cn(
                'h-8 w-full bg-transparent text-sm outline-none',
                isNeo
                  ? 'font-bold uppercase tracking-[0.08em] text-black placeholder:text-black/45'
                  : 'text-white placeholder:text-white/45',
              )}
            />
            <kbd
              className={cn(
                'shrink-0 text-xs font-semibold',
                isNeo
                  ? 'border-2 border-black bg-[var(--neo-panel)] px-2 py-1 text-black'
                  : 'rounded border border-white/15 bg-white/5 px-2 py-1 text-white/70',
              )}
            >
              {paletteShortcut}
            </kbd>
            <kbd
              className={cn(
                'shrink-0 text-xs font-semibold',
                isNeo
                  ? 'border-2 border-black bg-[var(--neo-panel)] px-2 py-1 text-black'
                  : 'rounded border border-white/15 bg-white/5 px-2 py-1 text-white/70',
              )}
            >
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty
              className={cn(
                'px-3 py-7 text-center text-sm',
                isNeo ? 'font-bold uppercase tracking-[0.08em] text-black/70' : 'text-white/60',
              )}
            >
              {isSearchingLibrary
                ? 'Searching your library…'
                : librarySearchFailed
                  ? 'Library search failed. Try again.'
                  : searchTerm.length >= 2
                    ? 'No tracks, albums, or commands match.'
                    : 'No matching commands.'}
            </Command.Empty>

            {searchTerm.length >= 2 && searchResults.length > 0 && (
              <>
                <Command.Group heading="Tracks" className="mb-2">
                  {searchResults.slice(0, 8).map((track) => (
                    <Command.Item
                      key={`track-${track.id}`}
                      value={`${searchTerm} ${track.title} ${track.artist} ${track.album}`}
                      onSelect={() => runAndClose(() => onPlaySearchResult(track, searchResults))}
                      className={cn(
                        'group flex cursor-pointer items-center gap-3 px-3 py-2.5 outline-none',
                        'data-[selected=true]:translate-x-[1px] data-[selected=true]:translate-y-[1px]',
                        isNeo
                          ? 'border-2 border-transparent text-black data-[selected=true]:border-black data-[selected=true]:bg-[var(--neo-utility-hover)] data-[selected=true]:shadow-[2px_2px_0_0_#000]'
                          : 'rounded-xl text-white/90 data-[selected=true]:bg-white/14 data-[selected=true]:text-white',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center',
                          isNeo
                            ? 'border-2 border-black bg-white'
                            : 'rounded-lg border border-white/10 bg-white/5',
                        )}
                      >
                        <Play className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate text-sm',
                            isNeo ? 'font-black uppercase tracking-[0.08em]' : 'font-semibold',
                          )}
                        >
                          {track.title}
                        </span>
                        <span
                          className={cn(
                            'block truncate text-xs',
                            isNeo ? 'text-black/70' : 'text-white/60',
                          )}
                        >
                          {track.artist} · {track.album}
                        </span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>

                {albumResults.length > 0 && (
                  <Command.Group heading="Albums" className="mb-2">
                    {albumResults.map((album) => (
                      <Command.Item
                        key={`album-${album.artist}-${album.album}`}
                        value={`${searchTerm} ${album.album} ${album.artist}`}
                        onSelect={() =>
                          runAndClose(() => onOpenLibrarySearch(`${album.album} ${album.artist}`))
                        }
                        className={cn(
                          'group flex cursor-pointer items-center gap-3 px-3 py-2.5 outline-none',
                          'data-[selected=true]:translate-x-[1px] data-[selected=true]:translate-y-[1px]',
                          isNeo
                            ? 'border-2 border-transparent text-black data-[selected=true]:border-black data-[selected=true]:bg-[var(--neo-utility-hover)] data-[selected=true]:shadow-[2px_2px_0_0_#000]'
                            : 'rounded-xl text-white/90 data-[selected=true]:bg-white/14 data-[selected=true]:text-white',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center',
                            isNeo
                              ? 'border-2 border-black bg-white'
                              : 'rounded-lg border border-white/10 bg-white/5',
                          )}
                        >
                          <Library className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-sm',
                              isNeo ? 'font-black uppercase tracking-[0.08em]' : 'font-semibold',
                            )}
                          >
                            {album.album} — {album.artist}
                          </span>
                          <span
                            className={cn(
                              'block text-xs',
                              isNeo ? 'text-black/70' : 'text-white/60',
                            )}
                          >
                            Search {album.count}{' '}
                            {album.count === 1 ? 'matching track' : 'matching tracks'}
                          </span>
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </>
            )}

            {(Object.keys(grouped) as Array<keyof typeof grouped>).map((group) => (
              <Command.Group key={group} heading={group} className="mb-2">
                {grouped[group].map((command) => {
                  const Icon = command.icon;
                  return (
                    <Command.Item
                      key={command.id}
                      disabled={command.disabled}
                      onSelect={() => runAndClose(command.onSelect)}
                      className={cn(
                        'group flex cursor-pointer items-center gap-3 px-3 py-2.5 outline-none',
                        'data-[selected=true]:translate-x-[1px] data-[selected=true]:translate-y-[1px]',
                        isNeo
                          ? 'border-2 border-transparent text-black data-[selected=true]:border-black data-[selected=true]:bg-[var(--neo-utility-hover)] data-[selected=true]:shadow-[2px_2px_0_0_#000] data-[disabled=true]:opacity-40'
                          : 'rounded-xl text-white/90 data-[selected=true]:bg-white/14 data-[selected=true]:text-white data-[disabled=true]:opacity-40',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center',
                          isNeo
                            ? 'border-2 border-black bg-white'
                            : 'rounded-lg border border-white/10 bg-white/5',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block text-sm',
                            isNeo ? 'font-black uppercase tracking-[0.08em]' : 'font-semibold',
                          )}
                        >
                          {command.label}
                        </span>
                        <span
                          className={cn(
                            'block text-xs',
                            isNeo ? 'font-bold text-black/70' : 'text-white/60',
                          )}
                        >
                          {command.disabled && command.disabledReason
                            ? command.disabledReason
                            : command.description}
                        </span>
                      </span>
                      {command.shortcut && (
                        <kbd
                          className={cn(
                            'ml-auto shrink-0 text-[12px] font-semibold',
                            isNeo
                              ? 'border-2 border-black bg-[var(--neo-panel)] px-1.5 py-0.5 font-bold'
                              : 'rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-white/50',
                          )}
                        >
                          {command.shortcut}
                        </kbd>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
});
