import { clsx } from 'clsx';
import { AlertTriangle, X } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
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

type ConfirmDialogAction = () => void | Promise<void>;

export interface ConfirmDialogProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  secondaryLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: ConfirmDialogAction;
  onSecondary?: ConfirmDialogAction;
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
    const [actionPending, setActionPending] = useState(false);
    const isBusy = busy || actionPending;
    const dismiss = onDismiss ?? onCancel;
    const latestActionsRef = useRef({ onConfirm, onSecondary, dismiss });
    latestActionsRef.current = { onConfirm, onSecondary, dismiss };

    const runAction = useCallback(
      (kind: 'onConfirm' | 'onSecondary', action: ConfirmDialogAction) => {
        if (isBusy) return;

        let result: void | Promise<void>;
        try {
          result = action();
        } catch {
          return;
        }

        if (!result || typeof result.then !== 'function') {
          latestActionsRef.current.dismiss();
          return;
        }

        setActionPending(true);
        void Promise.resolve(result)
          .then(() => {
            if (latestActionsRef.current[kind] === action) {
              latestActionsRef.current.dismiss();
            }
          })
          .catch(() => undefined)
          .finally(() => setActionPending(false));
      },
      [isBusy],
    );

    return (
      <Dialog open onOpenChange={(open) => !open && !isBusy && onCancel()}>
        <DialogContent
          showCloseButton={false}
          aria-busy={isBusy}
          className={clsx(
            'w-full max-w-md p-6',
            isNeobrutalism
              ? 'bg-white border-3 border-black shadow-[var(--neo-shadow-2xl)] radius-r3'
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
                    ? 'font-black uppercase tracking-normal text-black'
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
              disabled={isBusy}
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
              disabled={isBusy}
            >
              {cancelLabel}
            </Button>
            {secondaryLabel && onSecondary ? (
              <Button
                variant={isNeobrutalism ? 'default' : 'outline'}
                disabled={isBusy}
                onClick={() => runAction('onSecondary', onSecondary)}
              >
                {secondaryLabel}
              </Button>
            ) : null}
            <Button
              onClick={() => runAction('onConfirm', onConfirm)}
              variant={isDanger ? 'destructive' : 'default'}
              disabled={isBusy}
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
