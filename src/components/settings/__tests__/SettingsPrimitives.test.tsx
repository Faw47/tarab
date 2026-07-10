import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSelect,
  SettingsSwitch,
} from '../primitives';

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
  it('marks the active segmented option for assistive technology', () => {
    render(
      <SettingsSegmentedControl
        ariaLabel="Navigation style"
        value="top"
        onChange={vi.fn()}
        options={[
          { value: 'rail', label: 'Rail' },
          { value: 'top', label: 'Top' },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rail' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('supports keyboard selection in the custom settings select', () => {
    const onChange = vi.fn();

    render(
      <SettingsSelect value="system" aria-label="Select audio output device" onChange={onChange}>
        <option value="system">System default</option>
        <option value="headphones">Headphones</option>
        <option value="speakers">Speakers</option>
      </SettingsSelect>,
    );

    const select = screen.getByRole('combobox', { name: 'Select audio output device' });
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.keyDown(select, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('headphones');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('dismisses the custom settings select with Escape', () => {
    render(
      <SettingsSelect value="system" aria-label="Select audio output device">
        <option value="system">System default</option>
        <option value="headphones">Headphones</option>
      </SettingsSelect>,
    );

    const select = screen.getByRole('combobox', { name: 'Select audio output device' });
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(select, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
