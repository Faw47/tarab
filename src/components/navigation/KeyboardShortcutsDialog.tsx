import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  getCommandPaletteShortcutLabel,
  getDirectionalShortcutLabel,
} from '../../lib/platform-shortcuts';
import type { AppTheme } from '../../store/settings-store';

interface KeyboardShortcutsDialogProps {
  theme: AppTheme;
}

const SHORTCUTS_EVENT = 'tarab:open-keyboard-shortcuts';

export function KeyboardShortcutsDialog({ theme }: KeyboardShortcutsDialogProps) {
  const [open, setOpen] = useState(false);
  const isNeo = theme === 'neobrutalism';

  useEffect(() => {
    const openDialog = () => setOpen(true);
    window.addEventListener(SHORTCUTS_EVENT, openDialog);
    return () => window.removeEventListener(SHORTCUTS_EVENT, openDialog);
  }, []);

  const shortcuts = [
    { label: 'Focus library search', keys: '/' },
    { label: 'Open command palette', keys: getCommandPaletteShortcutLabel() },
    { label: 'Play or pause', keys: 'Space' },
    { label: 'Previous track', keys: getDirectionalShortcutLabel('previous') },
    { label: 'Next track', keys: getDirectionalShortcutLabel('next') },
    { label: 'Mute or unmute', keys: 'M' },
    { label: 'Toggle full player', keys: 'F' },
    { label: 'Close this dialog', keys: 'Esc' },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={
          isNeo
            ? 'max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-none border-[3px] border-black bg-white text-black shadow-[8px_8px_0_0_#000] sm:max-w-md'
            : 'max-h-[calc(100dvh-2rem)] overflow-y-auto border-white/15 bg-background/90 sm:max-w-md'
        }
      >
        <DialogHeader className={isNeo ? 'text-left' : 'text-left'}>
          <DialogTitle
            className={isNeo ? 'text-xl font-black uppercase tracking-wide text-black' : 'text-xl'}
          >
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className={isNeo ? 'text-black/70' : ''}>
            Quick controls for playback and navigation.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid gap-2">
          {shortcuts.map(({ label, keys }) => (
            <div
              className={
                isNeo
                  ? 'flex items-center justify-between gap-4 border-2 border-black bg-white px-3 py-2'
                  : 'flex items-center justify-between gap-4 rounded-md bg-white/5 px-3 py-2'
              }
              key={label}
            >
              <dt className={isNeo ? 'text-sm font-bold' : 'text-sm font-medium'}>{label}</dt>
              <dd className="m-0 shrink-0">
                <kbd
                  className={
                    isNeo
                      ? 'inline-flex min-w-10 justify-center border-2 border-black bg-white px-2 py-1 text-xs font-black shadow-[2px_2px_0_0_#000]'
                      : 'inline-flex min-w-10 justify-center rounded border border-white/15 bg-white/10 px-2 py-1 text-xs font-semibold'
                  }
                >
                  {keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
