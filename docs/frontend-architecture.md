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
- **Implementation:** Use `usePlaylistSearch` or `useTrackSearch` hooks to wrap raw data arrays with a Fuse index.

### 6. Keyboard Shortcuts (react-hotkeys-hook)
- **Rule:** Do not use manual `window.addEventListener('keydown')` for feature-level shortcuts.
- **Scoping:** Use the defined `HOTKEY_SCOPES` to prevent shortcut collisions between views and dialogs.

### 7. Virtualization (@tanstack/react-virtual)
- **Rule:** All lists expected to exceed 50-100 items must be virtualized.
- **Standardization:** Use the shared `VirtualizedList` component or the feature-specific `VirtualizedPlaylistTrackList`.
- **Constraint:** Virtualization is disabled during reorder/drag-and-drop modes to ensure DnD stability.
