import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Slider } from '../slider';

describe('Slider', () => {
  it('puts the accessible label on the actual slider thumb', () => {
    render(<Slider value={42} aria-label="Playback level" />);

    expect(screen.getByRole('slider', { name: 'Playback level' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
  });

  it('names every thumb in a multi-value slider', () => {
    render(<Slider value={[20, 80]} aria-label="Range selection" />);

    expect(screen.getAllByRole('slider', { name: 'Range selection' })).toHaveLength(2);
  });
});
