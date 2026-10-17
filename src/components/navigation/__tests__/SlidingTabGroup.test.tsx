import { render, screen } from '@testing-library/react';
import { Home, Library } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { SlidingTabGroup } from '../SlidingTabGroup';

const tabs = [
  { view: 'home' as const, label: 'Home', icon: Home },
  { view: 'library' as const, label: 'Library', icon: Library },
];

const pillOpacity = () => {
  const nav = screen.getByRole('navigation', { name: 'Primary sections' });
  return (nav.querySelector('.pointer-events-none.absolute') as HTMLElement).style.opacity;
};

describe('SlidingTabGroup', () => {
  it('hides the selection pill when the current view has no tab', () => {
    // Regression for FE-09: with Settings open the pill stayed on Home.
    render(<SlidingTabGroup tabs={tabs} currentView="settings" onNavigate={vi.fn()} />);

    expect(pillOpacity()).toBe('0');
    expect(screen.getByRole('button', { name: /Home/ })).not.toHaveAttribute('aria-current');
  });

  it('shows the pill for a matching tab', () => {
    render(<SlidingTabGroup tabs={tabs} currentView="library" onNavigate={vi.fn()} />);

    expect(pillOpacity()).not.toBe('0');
  });
});
