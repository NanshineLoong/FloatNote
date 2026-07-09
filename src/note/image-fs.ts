import { invoke } from "@tauri-apps/api/core";
import { slugifyImageName } from "./image-attrs";

const MAX_PASTE_BYTES = 20 * 1024 * 1024;

interface SaveImageResult { filename: string; relPath: string; }
interface ImportImageResult { source: string; relPath: string; error: string | null; }

/** Read a Blob to a base64 string (without the data: prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const dataUri = reader.result as string;
      const comma = dataUri.indexOf(",");
      resolve(comma >= 0 ? dataUri.slice(comma + 1) : dataUri);
    };
    reader.readAsDataURL(blob);
  });
}

/** Save a pasted image bitmap to `<projectDir>/_assets/` and return a markdown
 *  link `![](./_assets/...)`. Throws on >20 MB or backend failure. */
export async function savePastedImage(projectDir: string, blob: Blob): Promise<string> {
  if (blob.size > MAX_PASTE_BYTES) {
    throw new Error("图片过大（超过 20MB）");
  }
  const stem = `paste-${stamp()}`;
  const dataBase64 = await blobToBase64(blob);
  const result = await invoke<SaveImageResult>("save_pasted_image", {
    projectDir,
    suggestedStem: stem,
    dataBase64,
    mime: blob.type || "image/png",
  });
  return `![](${result.relPath})`;
}

/** Import dragged image file paths; return markdown links for successes only. */
export async function importImageFiles(projectDir: string, paths: string[]): Promise<string[]> {
  const results = await invoke<ImportImageResult[]>("import_image_files", {
    sourcePaths: paths,
    projectDir,
  });
  return results
    .filter((r) => !r.error && r.relPath)
    .map((r) => `![](${r.relPath})`);
}

/** Convert a markdown image url to a webview-loadable src.
 *  - http(s) → as-is
 *  - relative `./_assets/...` → resolved against noteDir, encoded
 *  - absolute → encoded as-is */
export function imageSrc(url: string, noteDir: string): string {
  if (/^https?:\/\//.test(url)) return url;
  let abs: string;
  if (url.startsWith("./") || url.startsWith("../")) {
    abs = joinPath(noteDir, url);
  } else {
    abs = url;
  }
  return "floatnote-img://local/" + encodeURIComponent(abs);
}

/** Join a base dir and a `./` / `../` relative path. Minimal, OS-agnostic. */
function joinPath(base: string, rel: string): string {
  const cleanRel = rel.replace(/^\.\//, "");
  const baseTrimmed = base.replace(/[\\/]+$/, "");
  return `${baseTrimmed}/${cleanRel}`.replace(/\\/g, "/");
}

/** Stable timestamp stamp for paste filenames (local time, no Date.now in hot path). */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// re-export so callers can build suggested stems from dropped filenames
export { slugifyImageName };
