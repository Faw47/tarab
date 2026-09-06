import { useShallow } from 'zustand/react/shallow';
import { useCoverArt } from '../../hooks/useCoverArt';
import { usePlayerStore } from '../../store/player-store';
import { useHomeLibraryModel } from './useHomeLibraryModel';
import { useHomePlaybackActions } from './useHomePlaybackActions';

export function useHomeViewModel(source: string) {
  const { currentTrack, isPlaying } = usePlayerStore(
    useShallow((state) => ({
      currentTrack: state.currentTrack,
      isPlaying: state.isPlaying,
    })),
  );

  const currentCoverUrl =
    useCoverArt(
      currentTrack?.filePath,
      currentTrack?.hasCoverArt,
      true,
      'large',
      currentTrack?.coverArtHash,
    ) ?? null;

  const library = useHomeLibraryModel();
  const playback = useHomePlaybackActions(currentTrack, source);

  return {
    currentTrack,
    isPlaying,
    currentCoverUrl,
    ...library,
    ...playback,
  };
}
