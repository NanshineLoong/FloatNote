import type { EditorView } from "@codemirror/view";
import {
  annotationProjection,
  type AnnotationProjectionSegment,
} from "@floatnote/note-logic";
import { inboxMetadata } from "./state";

export function renderProjectionSegments(
  root: HTMLElement,
  markdown: string,
  segments: AnnotationProjectionSegment[],
): void {
  root.innerHTML = "";
  for (const segment of segments) {
    const item = document.createElement("div");
    item.className = "annotation-projection-item";
    item.tabIndex = 0;
    item.setAttribute("role", "listitem");
    item.dataset.from = String(segment.matches[0]?.from ?? segment.from);
    item.dataset.to = String(segment.matches[0]?.to ?? segment.to);
    let offset = segment.from;
    for (const match of segment.matches) {
      item.append(document.createTextNode(markdown.slice(offset, match.from)));
      const mark = document.createElement("mark");
      mark.textContent = markdown.slice(match.from, match.to);
      item.appendChild(mark);
      offset = match.to;
    }
    item.append(document.createTextNode(markdown.slice(offset, segment.to)));
    root.appendChild(item);
  }
}

export interface AnnotationProjectionHandle {
  setActive: (tagId: string | null) => void;
  refresh: () => void;
  active: () => string | null;
}

export function mountAnnotationProjection(
  root: HTMLElement,
  view: EditorView,
  onExit: () => void,
): AnnotationProjectionHandle {
  root.className = "annotation-projection";
  root.setAttribute("role", "list");
  const editorRoot = view.dom.parentElement;
  let activeTag: string | null = null;

  const navigate = (item: HTMLElement): void => {
    const from = Number(item.dataset.from);
    const to = Number(item.dataset.to);
    onExit();
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  };
  root.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(".annotation-projection-item");
    if (!item) return;
    for (const candidate of root.querySelectorAll(".active")) candidate.classList.remove("active");
    item.classList.add("active");
    item.focus();
  });
  root.addEventListener("dblclick", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(".annotation-projection-item");
    if (item) navigate(item);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const item = (event.target as HTMLElement).closest<HTMLElement>(".annotation-projection-item");
    if (item) { event.preventDefault(); navigate(item); }
  });

  const refresh = (): void => {
    if (activeTag === null) return;
    const markdown = view.state.doc.toString();
    renderProjectionSegments(root, markdown, annotationProjection(
      markdown,
      inboxMetadata(view.state).annotations,
      activeTag,
    ));
  };
  const setActive = (tagId: string | null): void => {
    activeTag = tagId;
    root.hidden = tagId === null;
    if (editorRoot) editorRoot.hidden = tagId !== null;
    if (tagId !== null) refresh();
  };
  setActive(null);
  return { setActive, refresh, active: () => activeTag };
}
