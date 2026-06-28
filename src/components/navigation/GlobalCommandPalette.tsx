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
import { cn } from '@/lib/utils';
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
}

interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  group: 'Navigation' | 'Playback' | 'Library';
  icon: LucideIcon;
  disabled?: boolean;
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
}: GlobalCommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const isNeo = theme === 'neobrutalism';

  const runAndClose = useCallback((runner: () => void | Promise<void>) => {
    setOpen(false);
    setQuery('');
    void Promise.resolve(runner()).catch((error) =>
      reportError('Command failed', {
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
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'nav-home',
        label: 'Go to Home',
        description: 'Open the home dashboard',
        group: 'Navigation',
        icon: Home,
        disabled: currentView === 'home',
        onSelect: () => onNavigate('home'),
      },
      {
        id: 'nav-library',
        label: 'Go to Library',
        description: 'Browse your full music library',
        group: 'Navigation',
        icon: Library,
        disabled: currentView === 'library',
        onSelect: () => onNavigate('library'),
      },
      {
        id: 'nav-queue',
        label: 'Go to Queue',
        description: 'View and reorder up next tracks',
        group: 'Navigation',
        icon: ListMusic,
        disabled: currentView === 'queue',
        onSelect: () => onNavigate('queue'),
      },
      {
        id: 'nav-tags',
        label: 'Go to Tags',
        description: 'Edit metadata and tag fields',
        group: 'Navigation',
        icon: Tag,
        disabled: currentView === 'tags',
        onSelect: () => onNavigate('tags'),
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        description: 'Open app preferences and options',
        group: 'Navigation',
        icon: Settings,
        disabled: currentView === 'settings',
        onSelect: () => onNavigate('settings'),
      },
      {
        id: 'play-toggle',
        label: isPlaying ? 'Pause Playback' : 'Resume Playback',
        description: 'Toggle current playback state',
        group: 'Playback',
        icon: isPlaying ? Pause : Play,
        disabled: !hasCurrentTrack,
        onSelect: onTogglePlayback,
      },
      {
        id: 'play-next',
        label: 'Next Track',
        description: 'Skip forward in the queue',
        group: 'Playback',
        icon: SkipForward,
        disabled: !hasCurrentTrack,
        onSelect: onNextTrack,
      },
      {
        id: 'play-previous',
        label: 'Previous Track',
        description: 'Go to previous track or restart current',
        group: 'Playback',
        icon: SkipBack,
        disabled: !hasCurrentTrack,
        onSelect: onPreviousTrack,
      },
      {
        id: 'play-full-player',
        label: 'Open Full Player',
        description: 'Expand to full player view',
        group: 'Playback',
        icon: Maximize2,
        disabled: !hasCurrentTrack,
        onSelect: onOpenFullPlayer,
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
        onSelect: onRescanLibrary,
      },
    ],
    [
      currentView,
      hasCurrentTrack,
      isPlaying,
      isScanning,
      onNavigate,
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
    <div
      className={cn(
        'fixed inset-0 z-[160] flex items-start justify-center px-4 pt-[10vh]',
        isNeo ? 'bg-black/45' : 'bg-black/55 backdrop-blur-sm',
      )}
      onMouseDown={() => setOpen(false)}
    >
      <div
        className={cn(
          'w-full max-w-2xl',
          isNeo
            ? 'border-3 border-black bg-white shadow-[12px_12px_0_0_#000]'
            : 'rounded-2xl border border-white/10 bg-[#0f1118]/95 shadow-2xl',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
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
              placeholder="Type a command…"
              className={cn(
                'h-8 w-full bg-transparent text-sm outline-none',
                isNeo
                  ? 'font-bold uppercase tracking-[0.08em] text-black placeholder:text-black/45'
                  : 'text-white placeholder:text-white/45',
              )}
            />
            <kbd
              className={cn(
                'shrink-0 text-[10px] font-semibold',
                isNeo
                  ? 'border-2 border-black bg-[#F6F6F6] px-2 py-1 text-black'
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
              No matching commands.
            </Command.Empty>

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
                          ? 'border-2 border-transparent text-black data-[selected=true]:border-black data-[selected=true]:bg-[#E4C463] data-[selected=true]:shadow-[2px_2px_0_0_#000] data-[disabled=true]:opacity-40'
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
                          {command.description}
                        </span>
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
});
