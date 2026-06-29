import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { Button, type ButtonProps } from './button';

type IconButtonLabelProps =
  | { 'aria-label': string; title?: string }
  | { 'aria-label'?: string; title: string };

interface IconButtonBaseProps extends Omit<ButtonProps, 'size' | 'variant'> {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive' | 'danger';
}

type IconButtonProps = IconButtonBaseProps & IconButtonLabelProps;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = 'md', variant = 'default', ...props }, ref) => {
    const mapSize = {
      sm: 'icon-sm',
      md: 'icon',
      lg: 'icon-lg',
    } as const;

    const mapVariant = (v: IconButtonProps['variant']): ButtonProps['variant'] => {
      if (v === 'default') return 'secondary';
      return v;
    };
    const explicitAria = props['aria-label'];
    const title = props.title;
    const ariaLabel = explicitAria ?? (typeof title === 'string' && title.trim().length > 0 ? title : undefined);

    return (
      <Button
        ref={ref}
        size={mapSize[size]}
        variant={mapVariant(variant)}
        className={clsx(
          'rounded-full',
          variant === 'ghost' && 'text-text-muted hover:text-white',
          className,
        )}
        aria-label={ariaLabel}
        {...props}
      />
    );
  },
);

IconButton.displayName = 'IconButton';
