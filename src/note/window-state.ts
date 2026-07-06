import type { NoteEntry, ProjectEntry } from "./notes-state";

/**
 * The four mutually-exclusive states the note window can render. Replaces the
 * old "always auto-create a file" fallbacks: empty conditions now surface as
 * explicit empty-state UI instead of silently scaffolding files.
 *
 *  - NO_PROJECT: the working directory holds no project spaces (first launch,
 *    everything deleted). Render the welcome empty state.
 *  - PATH_ERROR: `list_projects` / `resolve_projects` failed (missing dir, no
 *    read permission). Render the error empty state with a retry/open-settings.
 *  - NO_PIECE: a project is open but it has no piece files yet. Render the
 *    in-project empty state.
 *  - LOADED: a project and a piece are both ready; render the editor.
 */
export type WindowState =
  | { kind: "NO_PROJECT"; startDir: string }
  | { kind: "PATH_ERROR"; startDir: string; error: string }
  | { kind: "NO_PIECE"; project: ProjectEntry }
  | { kind: "LOADED"; project: ProjectEntry; piece: NoteEntry };

/**
 * Stage-1 bootstrap outcome. Either we know which project to open, or we land
 * in a terminal empty state. `NO_PROJECT` / `PATH_ERROR` are shape-compatible
 * with `WindowState` so the caller can promote them directly.
 */
export type BootstrapOutcome =
  | { kind: "NO_PROJECT"; startDir: string }
  | { kind: "PATH_ERROR"; startDir: string; error: string }
  | { kind: "OPEN"; project: ProjectEntry };

/**
 * Decide which project to open from the MRU list and the working-directory
 * scan. MRU wins; otherwise the newest project on disk; otherwise NO_PROJECT.
 * Any error from the upstream listing calls becomes PATH_ERROR. Pure: no I/O.
 */
export function resolveBootstrap(input: {
  recent: ProjectEntry[];
  projects: ProjectEntry[];
  startDir: string;
  error?: string;
}): BootstrapOutcome {
  if (input.error) {
    return { kind: "PATH_ERROR", startDir: input.startDir, error: input.error };
  }
  const project = input.recent[0] ?? input.projects[0];
  if (!project) {
    return { kind: "NO_PROJECT", startDir: input.startDir };
  }
  return { kind: "OPEN", project };
}

/**
 * Stage-2: given the project we are opening and its piece list, decide between
 * LOADED (pieces present) and NO_PIECE (empty). Pieces are pre-sorted newest-
 * first by the backend; we take the first. Pure: no I/O. A `list_pieces` error
 * is the caller's concern — it should re-run bootstrap rather than mask it.
 */
export function resolveOpenProject(input: {
  project: ProjectEntry;
  pieces: NoteEntry[];
}): WindowState {
  const piece = input.pieces[0];
  if (!piece) {
    return { kind: "NO_PIECE", project: input.project };
  }
  return { kind: "LOADED", project: input.project, piece };
}
