import { fireEvent, render, screen } from '@testing-library/react';
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

  it('still navigates on the first click after the pill is disabled', () => {
    // Review regression for FE-09: a press released off the tabs left the click-suppression
    // flag set, and with the pill disabled nothing cleared it, so the next tab click was lost.
    const onNavigate = vi.fn();
    // jsdom has neither PointerEvent nor pointer capture; without them the press is ignored.
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const { rerender } = render(
      <SlidingTabGroup tabs={tabs} currentView="home" onNavigate={onNavigate} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Primary sections' });
    fireEvent.pointerDown(nav, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(nav, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    rerender(<SlidingTabGroup tabs={tabs} currentView="settings" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Library/ }));

    expect(onNavigate).toHaveBeenLastCalledWith('library');
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    vi.unstubAllGlobals();
  });
});
