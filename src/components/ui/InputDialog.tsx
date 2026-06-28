import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/settings-store';
import { Button } from './button';
import { IconButton } from './IconButton';

export interface InputDialogProps {
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export const InputDialog = memo(
  ({
    title,
    label,
    placeholder = '',
    initialValue = '',
    submitLabel = 'Save',
    cancelLabel = 'Cancel',
    onSubmit,
    onCancel,
  }: InputDialogProps) => {
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';
    const [value, setValue] = useState(initialValue);
    const inputId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    // Reset value when initialValue changes
    useEffect(() => {
      setValue(initialValue);
    }, [initialValue]);

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

    const handleSubmit = useCallback(() => {
      const trimmed = value.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
      onCancel(); // Close dialog after submit
    }, [value, onSubmit, onCancel]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        }
      },
      [handleSubmit],
    );

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
              ? 'bg-white border-3 border-black shadow-[12px_12px_0_0_#000] rounded-none'
              : 'rounded-2xl border border-zinc-800 bg-surface shadow-2xl',
          )}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="input-dialog-title"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3
              id="input-dialog-title"
              className={clsx(
                'text-lg',
                isNeobrutalism
                  ? 'font-black uppercase tracking-tight text-black'
                  : 'font-semibold text-text-primary',
              )}
            >
              {title}
            </h3>
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
            {label && (
              <label
                htmlFor={inputId}
                className={clsx(
                  'block text-sm',
                  isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
                )}
              >
                {label}
              </label>
            )}
            <input
              id={inputId}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              aria-label={label ?? title}
              className={clsx(
                'w-full px-4 py-3 outline-none transition-all duration-200',
                isNeobrutalism
                  ? 'bg-white border-2 border-black rounded-none shadow-[4px_4px_0_0_#000] focus:shadow-[6px_6px_0_0_#000] focus:-translate-x-0.5 focus:-translate-y-0.5 text-black font-bold placeholder:text-black/40'
                  : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700 focus:ring-2 focus:ring-primary',
              )}
              autoFocus
              onKeyDown={handleKeyDown}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant={isNeobrutalism ? 'default' : 'ghost'} onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button onClick={handleSubmit} disabled={!value.trim()} variant="default">
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  },
);

InputDialog.displayName = 'InputDialog';
