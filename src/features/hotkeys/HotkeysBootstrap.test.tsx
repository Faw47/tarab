import { fireEvent, render, screen } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';

import { HotkeysBootstrap } from './HotkeysBootstrap';

describe('HotkeysBootstrap', () => {
  it('opens search with slash but ignores text entry targets', () => {
    const onSearch = vi.fn();

    render(
      <HotkeysProvider>
        <input aria-label="Filter" />
        <HotkeysBootstrap onSearch={onSearch} />
      </HotkeysProvider>,
    );

    fireEvent.keyDown(document, { key: '/', code: 'Slash' });
    expect(onSearch).toHaveBeenCalledTimes(1);

    screen.getByRole('textbox', { name: 'Filter' }).focus();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Filter' }), { key: '/', code: 'Slash' });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});
