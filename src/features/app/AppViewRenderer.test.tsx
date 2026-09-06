import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppViewRenderer, type AppViewRendererProps } from './AppViewRenderer';

vi.mock('../../components/home/HomeView', () => ({
  HomeView: () => <div data-testid="liquid-home" />,
}));

vi.mock('../../components/home/HomeViewNeo', () => ({
  HomeViewNeo: () => <div data-testid="neo-home" />,
}));

const baseProps = {
  currentView: 'album',
  theme: 'neobrutalism',
  navMode: 'topNav',
  albumDetails: null,
  selectedTracks: [],
  initialLibraryLoading: false,
  libraryLoadError: null,
} as unknown as AppViewRendererProps;

describe('AppViewRenderer', () => {
  it('keeps a missing album details fallback inside Suspense for lazy theme views', async () => {
    render(<AppViewRenderer {...baseProps} />);

    expect(await screen.findByTestId('neo-home')).toBeInTheDocument();
  });
});
