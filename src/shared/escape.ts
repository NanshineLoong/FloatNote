/** Escape `& < > " '` so a string can be safely interpolated into HTML text
 *  content or attribute values. Shared across windows to avoid the five
 *  near-duplicate copies that previously drifted in apostrophe encoding. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}
