import { wrap, type Remote } from 'comlink';
import type { LibraryWorker, SearchScope, SerializedTrack } from './library.worker';

let workerApi: Remote<LibraryWorker> | null = null;

const getWorker = (): Remote<LibraryWorker> => {
  if (!workerApi) {
    workerApi = wrap<LibraryWorker>(
      new Worker(new URL('./library.worker.ts', import.meta.url), { type: 'module' }),
    );
  }
  return workerApi;
};

export const rankTracksWithFuseWorker = async (
  tracks: SerializedTrack[],
  query: string,
  searchScope: SearchScope,
): Promise<SerializedTrack[]> => {
  const api = getWorker();
  return api.rankTracks(tracks, query, searchScope);
};
