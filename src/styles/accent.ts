/**
 * Indigo-derived accent constants for runtimes that cannot read CSS custom
 * properties — specifically CodeMirror `EditorView.theme({...})` in
 * `src/note/preview/builder.ts`, which compiles to a static stylesheet.
 *
 * These mirror the locked Indigo values in `src/styles/primitives.css`
 * (--indigo-600 / --indigo-700 / --indigo-400). Keep them in sync with that
 * file; they are the single source of truth for accent values used outside
 * CSS. Tag-chip palette colors (shared/note-logic/.../palette.ts) are
 * intentionally NOT indigo and are left untouched.
 */
export const ACCENT = "#4f46e5";        /* --indigo-600, light primary */
export const ACCENT_HOVER = "#4338ca"; /* --indigo-700, light hover */
export const ACCENT_DARK = "#818cf8";  /* --indigo-400, dark primary */
