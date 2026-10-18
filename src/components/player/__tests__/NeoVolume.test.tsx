import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NeoVolumeSegments } from '../NeoVolumeSegments';

describe('NeoVolumeSegments (FE-16)', () => {
  it('is one slider with keyboard steps instead of ten role=button cells', () => {
    const onChange = vi.fn();
    const { container } = render(<NeoVolumeSegments volume={0.5} onChange={onChange} />);
    expect(container.querySelector('[role="button"]')).toBeNull();
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(slider).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(0.6);
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(0.4);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('still sets a level when a cell is clicked', () => {
    const onChange = vi.fn();
    const { container } = render(<NeoVolumeSegments volume={0} onChange={onChange} />);
    const cells = container.querySelectorAll('[aria-hidden="true"]');
    fireEvent.click(cells[2]);
    expect(onChange).toHaveBeenCalledWith(0.3);
  });
});
