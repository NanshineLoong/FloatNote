export type ImageAlign = "left" | "center" | "right";

export interface ImageAttrs {
  caption: string;
  url: string;
  width: number | null;
  align: ImageAlign | null;
}

const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)/;

/** Parse a raw `![...](...)` image token (optionally followed by `{...}`).
 *  Returns null if the text does not start with an image. */
export function parseImage(raw: string): ImageAttrs | null {
  const m = IMAGE_RE.exec(raw);
  if (!m) return null;
  const caption = m[1] ?? "";
  const url = (m[2] ?? "").trim();
  const rest = raw.slice(m[0].length);
  const { width, align } = parseAttrBlock(rest.trim());
  return { caption, url, width, align };
}

/** Parse a `{width=N .align}` block. Tolerant: garbage or missing → nulls. */
export function parseAttrBlock(textAfterUrl: string): { width: number | null; align: ImageAlign | null } {
  const m = /^\{([^}]*)\}/.exec(textAfterUrl);
  if (!m) return { width: null, align: null };
  const body = m[1];
  const widthMatch = /\bwidth\s*=\s*(\d+)/.exec(body);
  const alignMatch = /\.(left|center|right)\b/.exec(body);
  return {
    width: widthMatch ? parseInt(widthMatch[1], 10) : null,
    align: alignMatch ? (alignMatch[1] as ImageAlign) : null,
  };
}

/** Emit canonical `![caption](url){width=N .align}`. Omit the block / parts
 *  that are null so plain images stay plain. */
export function writeAttrs(attrs: ImageAttrs): string {
  const cls = attrs.align ? `.${attrs.align}` : null;
  const w = attrs.width != null ? `width=${attrs.width}` : null;
  const parts = [w, cls].filter((p): p is string => p != null);
  const block = parts.length ? `{${parts.join(" ")}}` : "";
  return `![${attrs.caption}](${attrs.url})${block}`;
}

/** Same rule as Rust `slugify`: spaces and `/ \ :` → `-`, unicode preserved. */
export function slugifyImageName(name: string): string {
  return Array.from(name)
    .map((c) => (/\s|\/|\\|:/.test(c) ? "-" : c))
    .join("")
    .replace(/^-+|-+$/g, "");
}
