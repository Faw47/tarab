import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../../store/settings-store';
import { SettingsActionButton } from '../primitives/SettingsActionButton';

describe('SettingsActionButton', () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: 'neobrutalism' });
  });

  afterEach(() => {
    useSettingsStore.setState({ theme: 'liquid-glass' });
  });

  it('renders destructive actions with the Neo danger signal', () => {
    render(<SettingsActionButton tone="danger">Purge</SettingsActionButton>);

    const button = screen.getByRole('button', { name: 'Purge' });
    expect(button).toHaveClass('bg-[var(--signal-danger)]', 'text-[var(--neo-ink)]');
    expect(button).not.toHaveClass('bg-[var(--neo-paper)]');
  });

  it('keeps ghost actions borderless in Neobrutalism', () => {
    render(<SettingsActionButton tone="ghost">Cancel</SettingsActionButton>);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass(
      'border-transparent',
      'shadow-none',
      'bg-transparent',
    );
  });
});
