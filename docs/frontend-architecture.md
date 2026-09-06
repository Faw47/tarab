# Frontend Architecture

This document outlines the architectural standards for the Tarab frontend following the 2026 modernization migration.

## Core Stack & Responsibilities

### 1. Data Validation (Zod)
- **Rule:** No data enters the application from external boundaries (Tauri IPC, Local Storage, API) without being parsed by a Zod schema.
- **Location:** `src/lib/validation/`
- **Usage:** Use `.parse()` for hard boundaries where invalid data is a failure, and `.safeParse()` for recovery scenarios like settings hydration.

### 2. Async State Management (TanStack Query)
- **Rule:** All "server-side" data (playlists, tracks, metadata) is managed by TanStack Query. Zustand should **not** own fetch lifecycles or caching for this data.
- **Location:** `src/features/[feature]/queries.ts` and `mutations.ts`.
- **Cache Invalidation:** Mutations must explicitly invalidate relevant query keys or perform optimistic updates to keep the UI in sync.
- **Library snapshots:** The standard library page lives at `libraryKeys.tracks()`. Tag Manager's full-library bulk-edit snapshot lives at `libraryKeys.tagManagerTracks()` and is loaded through the cancellable cursor snapshot loader with progress updates. Library mutations and metadata refreshes invalidate both keys; Tag Manager must not maintain an uncached fetch lifecycle of its own.

### 3. Client State Management (Zustand)
- **Rule:** Zustand is reserved for **purely client-side state**:
    - Player transport (current track, queue, volume).
    - UI state (active view, open dialogs, selection sets).
    - Persisted user preferences (theme, nav mode).
- **Debugging:** All stores are wrapped in `devtools` middleware with named actions.

### 4. Forms (React Hook Form)
- **Rule:** Any UI component with validation, reset logic, or complex inputs must use React Hook Form.
- **Integration:** Use `@hookform/resolvers/zod` to link forms to the shared Zod schemas.
- **Auto-save:** For settings, use the `watch()` subscription pattern to sync changes to the store.

### 5. Search (Fuse.js)
- **Rule:** All search bars must provide fuzzy matching and weighted results.
- **Implementation:** The Library search uses `useLibraryData`, SQLite/lyrics search, and the worker-backed Fuse ranking path. Its scope selector changes the weighted metadata keys (`tracks`, `albums`, or `artists`) or switches to lyric-only search; it must not bypass the validated API boundary.
- **Loading and failure behavior:** Search metadata and lyrics branches may fail independently. Preserve every fulfilled branch, keep validated fallback rows when detail hydration fails, and report a failure only when all requested branches fail. When the requested search fails, expose a retry action and clearly identify any partial local fallback results.

### 6. Keyboard Shortcuts (react-hotkeys-hook)
- **Rule:** Do not use manual `window.addEventListener('keydown')` for feature-level shortcuts.
- **Scoping:** Use the defined `HOTKEY_SCOPES` to prevent shortcut collisions between views and dialogs.

### 7. Virtualization (@tanstack/react-virtual)
- **Rule:** All lists expected to exceed 50-100 items must be virtualized.
- **Standardization:** Use the shared `VirtualizedList` component or the feature-specific `VirtualizedPlaylistTrackList`.
- **Constraint:** Virtualization is disabled during reorder/drag-and-drop modes to ensure DnD stability.

### 8. Playback clock
- **Rule:** `player-store.currentTime` is coarse transport state and must not become a general React render signal.
- **Implementation:** `useSmoothTime` maintains an imperative anchor from current time, play/pause, and speed changes. `SmoothTimeProvider` publishes animation updates through subscriptions without changing provider state on every position event.
- **Consumers:** Small visible time/progress surfaces use `useSmoothTimeState` with bounded update frequency; karaoke surfaces use `useSmoothTimeValue` and direct DOM updates where appropriate.
- **Boundary:** Coordinators may read `usePlayerStore.getState().currentTime` for commands and persistence. UI components must not add direct React selectors for `currentTime`.

### 9. Theme-specific renderers
- **Rule:** Liquid Glass and Neobrutalism may keep separate visual renderers when their layout mechanics differ, but navigation labels, view identifiers, search behavior, processing status, and recovery actions must come from shared feature models/controllers.
- **Current boundary:** `TopBar.tsx` and `TopBarNeo.tsx` consume `top-bar-model.ts`, `navigation-model.ts`, and `useTopBarController`; `Sidebar.tsx` and `FloatingDock.tsx` consume the same view/label contract. Album details and search normalize to the Library destination for active navigation state; only visual composition and theme-specific controls remain divergent.
- **State surfaces:** Shared `StatePanel` content and `--state-*` tokens carry the same user message across themes while each theme owns its surface, border, ink, and motion treatment.