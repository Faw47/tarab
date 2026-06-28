import clsx from 'clsx';
import { Timer } from 'lucide-react';
import { type CSSProperties, memo, useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const PRESETS = [15, 30, 45, 60] as const;

const formatRemaining = (deadline: number): string => {
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

interface SleepTimerButtonProps {
  scheduleSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
  sleepDeadline: number | null;
}

export const SleepTimerButton = memo(
  ({ scheduleSleepTimer, cancelSleepTimer, sleepDeadline }: SleepTimerButtonProps) => {
    const [open, setOpen] = useState(false);
    const [remaining, setRemaining] = useState<string | null>(null);

    useEffect(() => {
      if (!sleepDeadline) {
        setRemaining(null);
        return;
      }
      const tick = () => {
        if (Date.now() >= sleepDeadline) {
          setRemaining(null);
          return;
        }
        setRemaining(formatRemaining(sleepDeadline));
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }, [sleepDeadline]);

    const handlePreset = useCallback(
      (minutes: number) => {
        scheduleSleepTimer(minutes);
        setOpen(false);
      },
      [scheduleSleepTimer],
    );

    const handleCancel = useCallback(() => {
      cancelSleepTimer();
      setOpen(false);
    }, [cancelSleepTimer]);

    const isActive = sleepDeadline != null;

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className={clsx('gap-1.5 rounded-full px-2.5', isActive && 'text-primary')}
            aria-label={isActive ? `Sleep timer: ${remaining} remaining` : 'Sleep timer'}
            title={isActive ? `Sleep timer: ${remaining} remaining` : 'Sleep timer'}
            style={
              isActive
                ? ({
                    '--adl-liquid-bg':
                      'color-mix(in oklch, var(--hero-accent) 18%, rgba(255,255,255,0.05))',
                    '--adl-liquid-bg-hover':
                      'color-mix(in oklch, var(--hero-accent) 24%, rgba(255,255,255,0.08))',
                    '--adl-liquid-bg-active':
                      'color-mix(in oklch, var(--hero-accent) 14%, rgba(255,255,255,0.04))',
                    '--adl-liquid-border':
                      'color-mix(in oklch, var(--hero-accent) 42%, rgba(255,255,255,0.16))',
                    '--adl-liquid-border-hover':
                      'color-mix(in oklch, var(--hero-accent) 54%, rgba(255,255,255,0.20))',
                    '--adl-liquid-text': 'var(--hero-accent)',
                    '--adl-liquid-shadow': '0 0 16px -6px var(--hero-glow)',
                  } as CSSProperties)
                : undefined
            }
          >
            <Timer className="w-4 h-4 shrink-0" />
            {isActive && remaining && (
              <span className="text-[10px] font-medium tabular-nums min-w-[2.5ch]">
                {remaining}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side="top"
          sideOffset={8}
          className="w-48 rounded-xl border-white/10 bg-white/[0.06] backdrop-blur-xl p-2"
        >
          <div className="space-y-1">
            <p className="px-2 py-1 text-xs font-medium text-white/70">Sleep timer</p>
            {PRESETS.map((mins) => (
              <Button
                key={mins}
                variant="ghost"
                size="sm"
                onClick={() => handlePreset(mins)}
                className="w-full justify-start rounded-xl"
              >
                {mins} min
              </Button>
            ))}
            {isActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="w-full justify-start rounded-xl text-white/80"
              >
                Cancel
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);

SleepTimerButton.displayName = 'SleepTimerButton';
