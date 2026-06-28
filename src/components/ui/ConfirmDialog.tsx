import { clsx } from 'clsx';
import { AlertTriangle, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/settings-store';
import { Button } from './button';
import { IconButton } from './IconButton';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = memo(
  ({
    title,
    message,
    detail,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
    onConfirm,
    onCancel,
  }: ConfirmDialogProps) => {
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      const dialogNode = dialogRef.current;
      if (!dialogNode) {
        return;
      }

      const getFocusable = () =>
        Array.from(
          dialogNode.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));

      const focusable = getFocusable();
      (focusable[0] ?? dialogNode).focus();

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
          return;
        }

        if (event.key !== 'Tab') {
          return;
        }

        const nodes = getFocusable();
        if (nodes.length === 0) {
          event.preventDefault();
          dialogNode.focus();
          return;
        }

        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      };

      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = previousOverflow;
        previousFocusRef.current?.focus();
      };
    }, [onCancel]);

    const handleConfirm = useCallback(() => {
      onConfirm();
      onCancel(); // Close dialog after confirm
    }, [onConfirm, onCancel]);

    const isDanger = variant === 'danger';

    return (
      <div
        className={clsx(
          'fixed inset-0 z-[100] flex items-center justify-center transition-all duration-200',
          isNeobrutalism ? 'bg-black/50' : 'bg-black/70 backdrop-blur-sm',
        )}
        onClick={onCancel}
      >
        <div
          ref={dialogRef}
          tabIndex={-1}
          className={clsx(
            'w-full max-w-md p-6',
            isNeobrutalism
              ? 'bg-white border-3 border-black shadow-[12px_12px_0_0_#000] radius-r3'
              : 'rounded-2xl border border-zinc-800 bg-surface shadow-2xl',
          )}
          onClick={(e) => e.stopPropagation()}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
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
              <h3
                id="confirm-dialog-title"
                className={clsx(
                  'text-lg',
                  isNeobrutalism
                    ? 'font-black uppercase tracking-tight text-black'
                    : 'font-semibold text-text-primary',
                )}
              >
                {title}
              </h3>
            </div>
            <IconButton
              size="sm"
              variant={isNeobrutalism ? 'default' : 'ghost'}
              onClick={onCancel}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </IconButton>
          </div>

          {/* Content */}
          <div className="space-y-3 mb-6">
            <p
              id="confirm-dialog-message"
              className={clsx(
                'text-sm',
                isNeobrutalism ? 'text-black/80 font-medium' : 'text-text-secondary',
              )}
            >
              {message}
            </p>
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

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant={isNeobrutalism ? 'default' : 'ghost'} onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button onClick={handleConfirm} variant={isDanger ? 'destructive' : 'default'}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  },
);

ConfirmDialog.displayName = 'ConfirmDialog';
