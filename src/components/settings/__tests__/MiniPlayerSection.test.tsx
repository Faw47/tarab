import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../../store/settings-store';
import { MiniPlayerSection } from '../sections/MiniPlayerSection';

describe('MiniPlayerSection', () => {
  it('describes the in-app player bar, not the always-on-top window', () => {
    // Regression for FE-14: the section described the separate mini window it does not control.
    useSettingsStore.setState({ theme: 'liquid-glass' });
    render(<MiniPlayerSection />);

    expect(screen.getByText('Now Playing Bar')).toBeInTheDocument();
    expect(screen.queryByText(/always-on-top/i)).not.toBeInTheDocument();
    expect(screen.getByText('Collapse to a floating pill')).toBeInTheDocument();
  });

  it('offers no collapse option in neobrutalism, which has no pill', () => {
    // Regression for FE-13: collapsing in neobrutalism left an empty bar.
    useSettingsStore.setState({ theme: 'neobrutalism' });
    render(<MiniPlayerSection />);

    expect(screen.queryByText('Collapse to a floating pill')).not.toBeInTheDocument();
  });
});
