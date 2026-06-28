import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsRow, SettingsSection, SettingsSwitch } from '../primitives';

describe('settings primitives', () => {
  it('renders labels, descriptions, and controls accessibly', () => {
    const onChange = vi.fn();

    render(
      <SettingsSection title="Playback" description="Playback settings">
        <SettingsRow
          label="Crossfade"
          description="Blend tracks together."
          control={<button type="button">Reset</button>}
        />
        <SettingsSwitch
          label="Gapless playback"
          description="Remove silence between tracks."
          checked
          disabled
          onChange={onChange}
        />
      </SettingsSection>,
    );

    expect(screen.getByRole('heading', { name: 'Playback' })).toBeInTheDocument();
    expect(screen.getByText('Blend tracks together.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();

    const toggle = screen.getByRole('switch', { name: 'Gapless playback' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
