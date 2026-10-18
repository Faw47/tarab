import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemovedFilesSettings } from '../CacheSettings';

const { listMock, restoreMock, purgeMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  restoreMock: vi.fn(async () => []),
  purgeMock: vi.fn(async () => []),
}));

vi.mock('../../../lib/tauri-commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tauri-commands')>()),
  listTrashedFiles: listMock,
  restoreTrashedFiles: restoreMock,
  purgeTrashedFiles: purgeMock,
}));

const item = {
  token: 'a'.repeat(32),
  originalPath: '/music/Fairuz/song.flac',
  title: 'Song',
  artist: 'Fairuz',
  sizeBytes: 2048,
  trashedAtMs: 0,
};

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RemovedFilesSettings />
    </QueryClientProvider>,
  );
}

describe('RemovedFilesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([item]);
  });

  it('lists removed files and restores one later', async () => {
    // Regression for QA-01: removed files could be restored only from a one-time dialog.
    renderSection();
    expect(await screen.findByText('Song')).toBeInTheDocument();

    listMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));

    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith([item.token]));
    expect(await screen.findByText('No removed files')).toBeInTheDocument();
  });

  it('deletes a removed file permanently only after confirmation', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Song permanently' }));
    expect(purgeMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    await waitFor(() => expect(purgeMock).toHaveBeenCalledWith([item.token]));
  });
});
