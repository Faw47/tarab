import { clsx } from 'clsx';
import { AlertTriangle, X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/settings-store';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { IconButton } from './IconButton';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  secondaryLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onSecondary?: () => void;
  onCancel: () => void;
  onDismiss?: () => void;
}

export const ConfirmDialog = memo(
  ({
    title,
    message,
    detail,
    confirmLabel = 'Confirm',
    secondaryLabel,
    cancelLabel = 'Cancel',
    variant = 'default',
    busy = false,
    onConfirm,
    onSecondary,
    onCancel,
    onDismiss,
  }: ConfirmDialogProps) => {
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';
    const isDanger = variant === 'danger';

    const handleConfirm = useCallback(() => {
      onConfirm();
      (onDismiss ?? onCancel)();
    }, [onCancel, onConfirm, onDismiss]);

    return (
      <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
        <DialogContent
          showCloseButton={false}
          aria-busy={busy}
          className={clsx(
            'w-full max-w-md p-6',
            isNeobrutalism
              ? 'bg-white border-3 border-black shadow-[12px_12px_0_0_#000] radius-r3'
              : 'rounded-2xl border border-zinc-800 bg-surface shadow-2xl',
          )}
        >
          <DialogHeader className="mb-4 flex-row items-start justify-between space-y-0 text-left">
            <div className="flex items-center gap-3">
              {isDanger && (
                <div
                  className={clsx(
                    'flex items-center justify-center w-10 h-10',
                    isNeobrutalism
                      ? 'border-2 border-black bg-[var(--signal-danger)] radius-r1'
                      : 'rounded-full bg-red-500/20',
                  )}
                >
                  <AlertTriangle
                    className={clsx('w-5 h-5', isNeobrutalism ? 'text-black' : 'text-red-400')}
                  />
                </div>
              )}
              <DialogTitle
                className={clsx(
                  'text-lg',
                  isNeobrutalism
                    ? 'font-black uppercase tracking-tight text-black'
                    : 'font-semibold text-text-primary',
                )}
              >
                {title}
              </DialogTitle>
            </div>
            <IconButton
              size="sm"
              variant={isNeobrutalism ? 'default' : 'ghost'}
              onClick={onCancel}
              disabled={busy}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </IconButton>
          </DialogHeader>

          <div className="space-y-3 mb-6">
            <DialogDescription
              className={clsx(
                'text-sm',
                isNeobrutalism ? 'text-black/80 font-medium' : 'text-text-secondary',
              )}
            >
              {message}
            </DialogDescription>
            {detail && (
              <p
                className={clsx(
                  'text-xs px-3 py-2 break-all',
                  isNeobrutalism
                    ? 'bg-black/5 border border-black radius-r1 text-black font-bold'
                    : 'text-text-muted font-mono bg-black/20 rounded-lg',
                )}
              >
                {detail}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant={isNeobrutalism ? 'default' : 'ghost'}
              onClick={onCancel}
              disabled={busy}
            >
              {cancelLabel}
            </Button>
            {secondaryLabel && onSecondary ? (
              <Button
                variant={isNeobrutalism ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => {
                  onSecondary();
                  (onDismiss ?? onCancel)();
                }}
              >
                {secondaryLabel}
              </Button>
            ) : null}
            <Button
              onClick={handleConfirm}
              variant={isDanger ? 'destructive' : 'default'}
              disabled={busy}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);

ConfirmDialog.displayName = 'ConfirmDialog';
