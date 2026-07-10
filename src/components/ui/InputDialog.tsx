import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/settings-store';
import { Button } from './button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './dialog';
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

    useEffect(() => {
      setValue(initialValue);
    }, [initialValue]);

    const handleSubmit = useCallback(() => {
      const trimmed = value.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
      onCancel();
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
      <Dialog open onOpenChange={(open) => !open && onCancel()}>
        <DialogContent
          showCloseButton={false}
          className={clsx(
            'w-full max-w-md p-6',
            isNeobrutalism
              ? 'bg-white border-3 border-black shadow-[12px_12px_0_0_#000] rounded-none'
              : 'rounded-2xl border border-zinc-800 bg-surface shadow-2xl',
          )}
        >
          <DialogHeader className="mb-4 flex-row items-center justify-between space-y-0 text-left">
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
            <IconButton
              size="sm"
              variant={isNeobrutalism ? 'default' : 'ghost'}
              onClick={onCancel}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </IconButton>
          </DialogHeader>

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

          <DialogFooter>
            <Button variant={isNeobrutalism ? 'default' : 'ghost'} onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button onClick={handleSubmit} disabled={!value.trim()} variant="default">
              {submitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);

InputDialog.displayName = 'InputDialog';
