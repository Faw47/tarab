'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { LiquidGlassSurface } from '../glass/LiquidGlassSurface';

type SliderRootProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>;

export interface SliderProps
  extends Omit<
    SliderRootProps,
    'value' | 'defaultValue' | 'onValueChange' | 'onValueCommit' | 'onChange'
  > {
  value?: number | number[];
  defaultValue?: number | number[];
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  onChange?: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  showTooltip?: boolean;
  formatTooltip?: (value: number) => string;
}

const normalizeValues = (
  values: number | number[] | undefined,
  fallback: number,
): number[] | undefined => {
  if (Array.isArray(values)) return values.length > 0 ? values : [fallback];
  if (typeof values === 'number' && Number.isFinite(values)) return [values];
  return undefined;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  (
    {
      className,
      defaultValue,
      value,
      min = 0,
      max = 100,
      showTooltip = false,
      formatTooltip,
      onValueChange,
      onValueCommit,
      onChange,
      onChangeEnd,
      onPointerDownCapture,
      onPointerUpCapture,
      onPointerCancelCapture,
      onBlurCapture,
      onMouseEnter,
      onMouseLeave,
      ...props
    },
    ref,
  ) => {
    const normalizedValue = React.useMemo(() => normalizeValues(value, min), [value, min]);
    const normalizedDefaultValue = React.useMemo(
      () => normalizeValues(defaultValue, min),
      [defaultValue, min],
    );
    const values = normalizedValue ?? normalizedDefaultValue ?? [min];
    const [isDragging, setIsDragging] = React.useState(false);
    const [isHovering, setIsHovering] = React.useState(false);
    const [tooltipValue, setTooltipValue] = React.useState(values[0] ?? min);

    React.useEffect(() => {
      if (!isDragging) {
        setTooltipValue(values[0] ?? min);
      }
    }, [isDragging, min, values]);

    const handleValueChange = React.useCallback(
      (nextValues: number[]) => {
        const next = nextValues[0] ?? min;
        setTooltipValue(next);
        onValueChange?.(nextValues);
        onChange?.(next);
      },
      [min, onChange, onValueChange],
    );

    const handleValueCommit = React.useCallback(
      (nextValues: number[]) => {
        const next = nextValues[0] ?? min;
        setTooltipValue(next);
        setIsDragging(false);
        onValueCommit?.(nextValues);
        onChangeEnd?.(next);
      },
      [min, onChangeEnd, onValueCommit],
    );

    const tooltipPosition = React.useMemo(() => {
      const range = max - min || 1;
      const ratio = (tooltipValue - min) / range;
      return clamp(ratio * 100, 0, 100);
    }, [max, min, tooltipValue]);

    const tooltipLabel = React.useMemo(() => {
      if (formatTooltip) return formatTooltip(tooltipValue);
      return Number.isInteger(tooltipValue) ? String(tooltipValue) : tooltipValue.toFixed(2);
    }, [formatTooltip, tooltipValue]);

    const shouldShowTooltip = showTooltip && (isDragging || isHovering);

    return (
      <div className="group relative w-full">
        {shouldShowTooltip && (
          <div
            className="panel pointer-events-none absolute -top-8 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 px-2 py-1 text-xs text-text-primary backdrop-blur-md"
            style={{ left: `${tooltipPosition}%` }}
          >
            {tooltipLabel}
          </div>
        )}

        <SliderPrimitive.Root
          ref={ref}
          data-slot="slider"
          value={normalizedValue}
          defaultValue={normalizedDefaultValue}
          min={min}
          max={max}
          onValueChange={handleValueChange}
          onValueCommit={handleValueCommit}
          onPointerDownCapture={(event) => {
            setIsDragging(true);
            onPointerDownCapture?.(event);
          }}
          onPointerUpCapture={(event) => {
            setIsDragging(false);
            onPointerUpCapture?.(event);
          }}
          onPointerCancelCapture={(event) => {
            setIsDragging(false);
            onPointerCancelCapture?.(event);
          }}
          onBlurCapture={(event) => {
            setIsDragging(false);
            onBlurCapture?.(event);
          }}
          onMouseEnter={(event) => {
            setIsHovering(true);
            onMouseEnter?.(event);
          }}
          onMouseLeave={(event) => {
            setIsHovering(false);
            onMouseLeave?.(event);
          }}
          className={cn(
            'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
            className,
          )}
          {...props}
        >
          <SliderPrimitive.Track
            data-slot="slider-track"
            className="relative grow overflow-hidden rounded-full bg-white/10 data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
          >
            <SliderPrimitive.Range
              data-slot="slider-range"
              className="absolute rounded-full bg-gradient-to-r from-primary via-accent to-primary-light transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-fast)] data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
            />
          </SliderPrimitive.Track>

          {Array.from({ length: values.length }, (_, index) => (
            <SliderPrimitive.Thumb
              data-slot="slider-thumb"
              key={index}
              className={cn(
                'block size-3.5 shrink-0 rounded-full border border-white/85 bg-transparent shadow-[0_2px_10px_rgba(0,0,0,0.36)] relative overflow-hidden',
                'transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-fast)] ease-out hover:scale-105 hover:ring-4 hover:ring-primary/25 focus-visible:ring-4 focus-visible:ring-primary/30 focus-visible:outline-none',
                'disabled:pointer-events-none disabled:opacity-50',
                isDragging && 'scale-105',
              )}
            >
              <LiquidGlassSurface
                className="absolute inset-0 pointer-events-none mix-blend-screen opacity-90"
                interactive={isDragging || isHovering}
              />
            </SliderPrimitive.Thumb>
          ))}
        </SliderPrimitive.Root>
      </div>
    );
  },
);

Slider.displayName = 'Slider';

export { Slider };
