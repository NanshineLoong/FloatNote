import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  addAnnotationRanges,
  eligibleSelectionRanges,
  freeColors,
  removeAnnotationRanges,
  type TextAnnotation,
  type TextRange,
} from "@floatnote/note-logic";
import { showToast } from "../../shared/toast";
import { createMenu } from "../../shared/ui/menu";
import { PALETTE } from "../tags/palette";
import { inboxMetadata, replaceInboxMetadata } from "./state";

export type AnnotationCoverage = "checked" | "mixed" | "unchecked";

export function annotationCoverage(
  annotations: TextAnnotation[],
  tagId: string,
  ranges: TextRange[],
): AnnotationCoverage {
  const tagged = annotations.filter((annotation) => annotation.tagId === tagId);
  let overlaps = false;
  let fullyCovered = true;
  for (const range of ranges) {
    const intersections = tagged
      .filter((annotation) => annotation.to > range.from && annotation.from < range.to)
      .sort((a, b) => a.from - b.from);
    overlaps ||= intersections.length > 0;
    let coveredTo = range.from;
    for (const annotation of intersections) {
      if (annotation.from > coveredTo) break;
      coveredTo = Math.max(coveredTo, annotation.to);
    }
    if (coveredTo < range.to) fullyCovered = false;
  }
  return fullyCovered && ranges.length > 0 ? "checked" : overlaps ? "mixed" : "unchecked";
}

let fallbackId = 0;

function annotationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `ann-${uuid.toLowerCase()}`;
  fallbackId += 1;
  return `ann-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

function tagId(name: string, existing: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tag";
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function applyTag(view: EditorView, id: string, ranges: TextRange[], coverage: AnnotationCoverage): void {
  const metadata = inboxMetadata(view.state);
  const annotations = coverage === "checked"
    ? removeAnnotationRanges(metadata.annotations, id, ranges, annotationId)
    : addAnnotationRanges(metadata.annotations, id, ranges, annotationId);
  view.dispatch({ effects: replaceInboxMetadata.of({ ...metadata, annotations }) });
}

function tagButton(
  view: EditorView,
  id: string,
  name: string,
  color: string,
  ranges: TextRange[],
  coverage: AnnotationCoverage,
  close: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fn-menu__item annotation-menu-tag";
  button.dataset.state = coverage;
  button.innerHTML = `<span class="annotation-menu-check" aria-hidden="true">${coverage === "checked" ? "✓" : coverage === "mixed" ? "−" : ""}</span><span class="annotation-menu-dot" style="--c:${color}"></span>`;
  const label = document.createElement("span");
  label.textContent = name;
  button.appendChild(label);
  button.onclick = () => {
    applyTag(view, id, ranges, coverage);
    close();
  };
  return button;
}

function newTagControls(view: EditorView, ranges: TextRange[], close: () => void): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "annotation-menu-create";
  const input = document.createElement("input");
  input.className = "fn-control tag-add-input";
  input.placeholder = "新建标签";
  input.maxLength = 24;
  const swatches = document.createElement("div");
  swatches.className = "swatch-row";
  const metadata = inboxMetadata(view.state);
  const available = new Set(freeColors(new Set(metadata.tags.map((tag) => tag.color.toLowerCase()))));
  let selected = [...available][0] ?? "";
  const commit = (): void => {
    const name = input.value.trim();
    if (!name || !selected) return;
    const current = inboxMetadata(view.state);
    const id = tagId(name, current.tags.map((tag) => tag.id));
    view.dispatch({ effects: replaceInboxMetadata.of({
      ...current,
      tags: [...current.tags, { id, name, color: selected }],
      annotations: addAnnotationRanges(current.annotations, id, ranges, annotationId),
    }) });
    close();
  };
  for (const swatch of PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.setProperty("--c", swatch.color);
    const enabled = available.has(swatch.color);
    button.disabled = !enabled;
    if (swatch.color === selected) button.classList.add("selected");
    button.onclick = () => {
      selected = swatch.color;
      for (const item of swatches.children) item.classList.remove("selected");
      button.classList.add("selected");
    };
    swatches.appendChild(button);
  }
  input.onkeydown = (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
  };
  const create = document.createElement("button");
  create.type = "button";
  create.className = "fn-menu__item annotation-menu-create-button";
  create.textContent = "创建并应用";
  create.onclick = commit;
  wrapper.append(input, swatches, create);
  return wrapper;
}

function openSelectionMenu(view: EditorView, event: MouseEvent, ranges: TextRange[]): void {
  const menu = createMenu();
  menu.el.classList.add("annotation-context-menu");
  const close = () => menu.hide();
  const metadata = inboxMetadata(view.state);
  const items: HTMLElement[] = metadata.tags.map((tag) => tagButton(
    view,
    tag.id,
    tag.name,
    tag.color,
    ranges,
    annotationCoverage(metadata.annotations, tag.id, ranges),
    close,
  ));
  items.push(newTagControls(view, ranges, close));
  menu.showAt(event.clientX, event.clientY, items);
}

function openPointMenu(view: EditorView, event: MouseEvent, point: number): boolean {
  const metadata = inboxMetadata(view.state);
  const containing = metadata.annotations.filter((annotation) => annotation.from <= point && point < annotation.to);
  if (containing.length === 0) return false;
  const tags = new Map(metadata.tags.map((tag) => [tag.id, tag]));
  const menu = createMenu();
  menu.el.classList.add("annotation-context-menu");
  const items = containing.flatMap((annotation) => {
    const tag = tags.get(annotation.tagId);
    if (!tag) return [];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fn-menu__item";
    button.textContent = `移除「${tag.name}」标注`;
    button.onclick = () => {
      const current = inboxMetadata(view.state);
      view.dispatch({ effects: replaceInboxMetadata.of({
        ...current,
        annotations: current.annotations.filter((item) => item.id !== annotation.id),
      }) });
      menu.hide();
    };
    return [button];
  });
  menu.showAt(event.clientX, event.clientY, items);
  return true;
}

export function annotationContextMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const selection = view.state.selection.main;
      if (!selection.empty) {
        const markdown = view.state.doc.toString();
        const ranges = eligibleSelectionRanges(markdown, { from: selection.from, to: selection.to });
        if (ranges.length === 0) {
          showToast("所选内容不支持标注");
          return false;
        }
        event.preventDefault();
        if (ranges.reduce((sum, range) => sum + range.to - range.from, 0) < selection.to - selection.from) {
          showToast("已跳过代码、链接地址或其他语法内容");
        }
        openSelectionMenu(view, event, ranges);
        return true;
      }
      const point = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (point === null || !openPointMenu(view, event, point)) return false;
      event.preventDefault();
      return true;
    },
  });
}
