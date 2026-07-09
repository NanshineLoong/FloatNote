import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { importImageFiles } from "./image-fs";
import type { EditorView } from "@codemirror/view";

interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** Listen for Tauri drag-drop; image files are imported into <noteDir>/_assets/
 *  and inserted at the caret. Returns an unlisten. */
export function imageDropHandler(
  getNoteDir: () => string,
  getView: () => EditorView | null,
): () => Promise<void> {
  let unlisten: UnlistenFn | null = null;
  const ready = listen<DragDropPayload>("tauri://drag-drop", (event) => {
    const view = getView();
    const dir = getNoteDir();
    if (!view || !dir) return;
    const paths = (event.payload.paths ?? []).filter((p) => IMAGE_EXT_RE.test(p));
    if (!paths.length) return;
    // Capture selection synchronously at drop-fire time, before the async
    // import — mirroring the imagePasteHandler fix. Re-reading selection after
    // the await would race against user edits that move the caret.
    const { from, to } = view.state.selection.main;
    void importImageFiles(dir, paths)
      .then((links) => {
        if (!links.length) return;
        const insert = links.join("\n") + "\n";
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
          userEvent: "input.drop",
          scrollIntoView: true,
        });
      })
      .catch((err) => {
        console.error("image drop failed", err);
      });
  });
  ready.then((fn) => {
    unlisten = fn;
  });
  return async () => {
    unlisten?.();
  };
}
