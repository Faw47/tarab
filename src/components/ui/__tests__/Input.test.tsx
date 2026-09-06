import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '../Input';
import { GlassSystemProvider } from '../liquid-glass';

describe('Input', () => {
  it('uses the liquid input contract by default and forwards native props', () => {
    render(<Input aria-label="Name" placeholder="My playlist" disabled />);

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveClass('bg-surface-light', 'rounded-lg', 'disabled:opacity-50');
    expect(input).toHaveAttribute('placeholder', 'My playlist');
    expect(input).toBeDisabled();
  });

  it('uses Neobrutalism styles from context or an explicit override', () => {
    const { rerender } = render(
      <GlassSystemProvider theme="neobrutalism">
        <Input aria-label="Context input" />
      </GlassSystemProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Context input' })).toHaveClass(
      'border-black',
      'rounded-none',
      'bg-white',
    );

    rerender(<Input theme="neobrutalism" aria-label="Explicit input" />);
    expect(screen.getByRole('textbox', { name: 'Explicit input' })).toHaveClass(
      'border-black',
      'rounded-none',
      'bg-white',
    );
  });
});
