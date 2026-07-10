import { useCallback, useMemo, useReducer } from 'react';
import type { NavView } from '../../components/navigation';
import type { AlbumDetailsState } from './app-state-types';

const MAX_STACK_DEPTH = 25;

interface ViewEntry {
  view: NavView;
  albumDetails?: AlbumDetailsState;
}

interface ViewRouterState {
  stack: ViewEntry[];
}

type ViewRouterAction =
  | { type: 'push'; entry: ViewEntry }
  | { type: 'replace'; entry: ViewEntry }
  | { type: 'pop' }
  | { type: 'setAlbumDetails'; details: AlbumDetailsState | null };

const makeEntry = (view: NavView, albumDetails?: AlbumDetailsState): ViewEntry =>
  view === 'album' ? { view, albumDetails } : { view };

const currentEntry = (state: ViewRouterState): ViewEntry =>
  state.stack[state.stack.length - 1] ?? { view: 'home' };

const capStack = (stack: ViewEntry[]): ViewEntry[] =>
  stack.length > MAX_STACK_DEPTH ? stack.slice(stack.length - MAX_STACK_DEPTH) : stack;

function viewRouterReducer(state: ViewRouterState, action: ViewRouterAction): ViewRouterState {
  switch (action.type) {
    case 'push': {
      const current = currentEntry(state);
      if (current.view === action.entry.view && action.entry.view !== 'album') {
        return { stack: [...state.stack.slice(0, -1), action.entry] };
      }
      return { stack: capStack([...state.stack, action.entry]) };
    }
    case 'replace':
      return { stack: [...state.stack.slice(0, -1), action.entry] };
    case 'pop':
      return state.stack.length > 1 ? { stack: state.stack.slice(0, -1) } : state;
    case 'setAlbumDetails': {
      if (!action.details) {
        const current = currentEntry(state);
        if (current.view !== 'album') return state;
        return { stack: [...state.stack.slice(0, -1), { view: 'library' }] };
      }
      return { stack: [...state.stack.slice(0, -1), makeEntry('album', action.details)] };
    }
    default:
      return state;
  }
}

export function useViewRouter(initialView: NavView = 'home') {
  const [state, dispatch] = useReducer(viewRouterReducer, {
    stack: [makeEntry(initialView)],
  });
  const current = currentEntry(state);
  const albumDetails = current.view === 'album' ? (current.albumDetails ?? null) : null;

  const navigate = useCallback(
    (view: NavView, options: { albumDetails?: AlbumDetailsState; replace?: boolean } = {}) => {
      dispatch({
        type: options.replace ? 'replace' : 'push',
        entry: makeEntry(view, options.albumDetails),
      });
    },
    [],
  );

  const replace = useCallback(
    (view: NavView, options: { albumDetails?: AlbumDetailsState } = {}) => {
      dispatch({ type: 'replace', entry: makeEntry(view, options.albumDetails) });
    },
    [],
  );

  const goBack = useCallback(() => {
    dispatch({ type: 'pop' });
  }, []);

  const setAlbumDetailsForCurrentView = useCallback((details: AlbumDetailsState | null) => {
    dispatch({ type: 'setAlbumDetails', details });
  }, []);

  return useMemo(
    () => ({
      currentView: current.view,
      albumDetails,
      canGoBack: state.stack.length > 1,
      navigate,
      replace,
      goBack,
      setAlbumDetailsForCurrentView,
    }),
    [
      albumDetails,
      current.view,
      goBack,
      navigate,
      replace,
      setAlbumDetailsForCurrentView,
      state.stack.length,
    ],
  );
}
