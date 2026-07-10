import { fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useTopBarSearchShortcuts } from '../useTopBarSearchShortcuts';

function Harness() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('query');
  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useTopBarSearchShortcuts({
    inputId: 'search-input',
    inputRef,
    onFocusSearch: focusSearch,
    onClearSearch: () => setQuery(''),
  });

  return (
    <>
      <input aria-label="Other input" />
      <input
        ref={inputRef}
        id="search-input"
        aria-label="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </>
  );
}

describe('useTopBarSearchShortcuts', () => {
  it('focuses search with slash, ignores text entry, and clears with Escape', () => {
    render(<Harness />);
    const search = screen.getByRole('textbox', { name: 'Search' });
    const other = screen.getByRole('textbox', { name: 'Other input' });

    fireEvent.keyDown(window, { key: '/' });
    expect(search).toHaveFocus();

    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    expect(other).toHaveFocus();

    search.focus();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).not.toHaveFocus();
  });
});
