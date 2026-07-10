import type { QueryClient } from '@tanstack/react-query';
import { Edit2, FolderOpen, Library, ListMusic, ListPlus, Play, Star, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import type { ContextMenuItem } from '../components/shared/ContextMenu';
import { invalidateLibraryForMutation } from '../features/library/mutations';
import { startPlayback } from '../lib/playback-actions';
import { reportError } from '../lib/report-error';
import { dbSetTrackRating } from '../lib/tauri-commands';
import type { Track } from '../types';

interface UseContextMenuBuilderProps {
  selectedTracks: Track[];
  contextMenuTrack: Track | null;
  addToQueue: (track: Track, position: 'next' | 'last') => void;
  setTagEditorTracks: (tracks: Track[] | null) => void;
  handleRevealTracks: (tracks: Track[]) => void;
  handleRemoveTracks: (tracks: Track[]) => void;
  handleRevealInLibrary: (tracks: Track[]) => void;
  applyTrackRatings: (trackIds: string[], rating: number | null) => void;
  openPlaylistPicker: (tracks: Track[]) => void;
  queryClient: QueryClient;
}

export function useContextMenuBuilder({
  selectedTracks,
  contextMenuTrack,
  addToQueue,
  setTagEditorTracks,
  handleRevealTracks,
  handleRemoveTracks,
  handleRevealInLibrary,
  applyTrackRatings,
  openPlaylistPicker,
  queryClient,
}: UseContextMenuBuilderProps) {
  const selectedOrContext = useMemo(
    () => (selectedTracks.length > 0 ? selectedTracks : contextMenuTrack ? [contextMenuTrack] : []),
    [selectedTracks, contextMenuTrack],
  );

  const contextMenuItems: ContextMenuItem[] = useMemo(
    () =>
      contextMenuTrack
        ? [
            // Playback actions
            {
              id: 'play',
              label: 'Play',
              icon: <Play className="w-4 h-4" />,
              onClick: async () => {
                const tracksToPlay = selectedOrContext;
                if (tracksToPlay.length === 0) return;
                const [first] = tracksToPlay;
                try {
                  await startPlayback(first, {
                    queue: tracksToPlay,
                    queueIndex: 0,
                  });
                } catch (e) {
                  reportError('Failed to start playback', { source: 'app', error: e });
                }
              },
            },
            {
              id: 'queue-next',
              label: 'Play Next',
              icon: <ListMusic className="w-4 h-4" />,
              onClick: () => {
                const tracksToAdd = selectedOrContext;
                if (tracksToAdd.length === 0) return;
                tracksToAdd
                  .slice()
                  .reverse()
                  .forEach((track) => addToQueue(track, 'next'));
              },
            },
            {
              id: 'queue',
              label: 'Add to Queue',
              icon: <ListMusic className="w-4 h-4" />,
              onClick: () => {
                const tracksToAdd = selectedOrContext;
                tracksToAdd.forEach((track) => addToQueue(track, 'last'));
              },
            },
            {
              id: 'add-to-playlist',
              label: 'Add to Playlist',
              icon: <ListPlus className="w-4 h-4" />,
              onClick: () => {
                openPlaylistPicker(selectedOrContext);
              },
            },
            // Edit actions
            {
              id: 'edit',
              label:
                selectedTracks.length > 1 ? `Edit ${selectedTracks.length} Tracks` : 'Edit Info',
              icon: <Edit2 className="w-4 h-4" />,
              divider: true,
              onClick: () => {
                if (selectedTracks.length > 1) {
                  setTagEditorTracks(selectedTracks);
                } else if (contextMenuTrack) {
                  setTagEditorTracks([contextMenuTrack]);
                }
              },
            },
            // Rating actions
            ...([1, 2, 3, 4, 5] as const).map((stars, i) => ({
              id: `rate-${stars}`,
              label: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`,
              icon: <Star className="w-4 h-4" />,
              divider: i === 0,
              onClick: async () => {
                const targetIds = selectedOrContext.map((track) => track.id);
                try {
                  await Promise.all(targetIds.map((trackId) => dbSetTrackRating(trackId, stars)));
                  applyTrackRatings(targetIds, stars);
                  await invalidateLibraryForMutation(queryClient, 'rating');
                } catch (error) {
                  reportError('Failed to update track rating', { source: 'app', error });
                }
              },
            })),
            {
              id: 'rate-clear',
              label: 'Clear Rating',
              icon: <Star className="w-4 h-4" />,
              onClick: async () => {
                const targetIds = selectedOrContext.map((track) => track.id);
                try {
                  await Promise.all(targetIds.map((trackId) => dbSetTrackRating(trackId, null)));
                  applyTrackRatings(targetIds, null);
                  await invalidateLibraryForMutation(queryClient, 'rating');
                } catch (error) {
                  reportError('Failed to clear track rating', { source: 'app', error });
                }
              },
            },
            // Reveal actions
            {
              id: 'reveal',
              label: 'Reveal in Finder',
              icon: <FolderOpen className="w-4 h-4" />,
              divider: true,
              onClick: () => {
                handleRevealTracks(selectedOrContext);
              },
            },
            {
              id: 'reveal-library',
              label: 'Reveal in Library',
              icon: <Library className="w-4 h-4" />,
              onClick: () => {
                handleRevealInLibrary(selectedOrContext);
              },
            },
            // Danger actions
            {
              id: 'remove',
              label:
                selectedOrContext.length > 1
                  ? `Remove ${selectedOrContext.length} from Library`
                  : 'Remove from Library',
              icon: <Trash2 className="w-4 h-4" />,
              divider: true,
              danger: true,
              onClick: () => {
                handleRemoveTracks(selectedOrContext);
              },
            },
          ]
        : [],
    [
      contextMenuTrack,
      selectedOrContext,
      selectedTracks.length,
      addToQueue,
      setTagEditorTracks,
      handleRevealTracks,
      handleRemoveTracks,
      handleRevealInLibrary,
      applyTrackRatings,
      openPlaylistPicker,
    ],
  );

  return { contextMenuItems };
}
