import { getVersion } from '@tauri-apps/api/app';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

vi.mock('../../../hooks/use-liquid-segmented-pill', () => ({
  applyVerticalPillDom: vi.fn(),
  useLiquidSegmentedPillVertical: () => ({
    pillStyle: { top: 0, height: 0, opacity: 0 },
    isDragging: false,
    pillLayoutFromDom: false,
    dragPreviewIndex: null,
    pillGeometryRef: { current: null },
    suppressNextTabClickRef: { current: false },
    listProps: {},
  }),
}));

import { SettingsShell } from '../SettingsShell';

describe('SettingsShell neo version badge (FE-34)', () => {
  beforeEach(() => {
    vi.mocked(getVersion).mockReset();
    vi.mocked(getVersion).mockResolvedValue('2.3.4');
  });

  const renderNeoSettings = () =>
    render(
      <SettingsShell page="library" setPage={vi.fn()} isNeobrutalism>
        <div>Settings content</div>
      </SettingsShell>,
    );

  it('shows the version reported by the Tauri application', async () => {
    renderNeoSettings();

    expect(await screen.findByText('TARAB V2.3.4')).toBeInTheDocument();
  });

  it('keeps the badge in the Settings heading row', async () => {
    const { container } = renderNeoSettings();

    const badge = await screen.findByText(/TARAB V/);
    expect(badge.parentElement).toHaveClass('neo-settings-heading-row');
    expect(container.querySelector('h1')).toHaveTextContent('Settings');
  });
});
