import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useState } from 'react';
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
import { Input } from './Input';

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
              ? 'bg-white border-3 border-black shadow-[var(--neo-shadow-2xl)] rounded-none'
              : 'rounded-2xl border border-zinc-800 bg-surface shadow-2xl',
          )}
        >
          <DialogHeader className="mb-4 flex-row items-center justify-between space-y-0 text-left">
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
            <IconButton
              size="sm"
              variant={isNeobrutalism ? 'default' : 'ghost'}
              onClick={onCancel}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </IconButton>
          </DialogHeader>

          <DialogDescription className="sr-only">
            {label ? `${label} for ${title}.` : `Enter a value for ${title}.`}
          </DialogDescription>

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
            <Input
              id={inputId}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              aria-label={label ?? title}
              theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
              className="w-full px-4 py-3"
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
