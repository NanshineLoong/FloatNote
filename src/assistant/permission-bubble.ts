import { invoke } from "@tauri-apps/api/core";
import { createButton } from "../shared/ui/button";
import { createPermissionAllowButton, type PermissionAllowButtonHandle } from "./permission-allow-button";
import { createPermissionDialog } from "./permission-dialog";
import { projectPermission, type PermissionPresentation } from "./permission-model";
export type { EditPreview, EditPreviewDetail, PermissionRequest, WriteMode } from "./permission-model";
import type { PermissionRequest, WriteMode } from "./permission-model";

export const TOOL_LABEL: Record<string, string> = {
  read_note: "读取文档", list_tags: "列出标签", list_notes: "列出笔记",
  web_search: "搜索网页", web_fetch: "读取网页", read_skill: "读取技能",
  edit_note: "编辑文本", write_note: "编辑文本", tag_text: "设置文本标签",
  tag_create: "新建标签", tag_update: "修改标签", create_note: "创建文档", tag_delete: "删除标签",
};

function renderTitle(presentation: PermissionPresentation): HTMLElement {
  const title = document.createElement("div");
  title.className = "perm-title";
  title.title = presentation.title;
  if (presentation.tagOperation) {
    const action = document.createElement("span");
    action.className = "perm-title-action";
    action.textContent = presentation.tagOperation.action;
    title.appendChild(action);
  } else {
    const text = document.createElement("span");
    text.className = "perm-title-text";
    text.textContent = presentation.title;
    title.appendChild(text);
  }
  for (const cue of presentation.colors) {
    const color = document.createElement("span");
    color.className = "perm-title-color";
    color.style.backgroundColor = cue.color;
    color.setAttribute("role", "img");
    color.setAttribute("aria-label", `${cue.label}，颜色 ${cue.color}`);
    color.title = `${cue.label}：${cue.color}`;
    title.appendChild(color);
  }
  if (presentation.tagOperation) {
    const name = document.createElement("span");
    name.className = "perm-title-tag-name";
    name.textContent = `「${presentation.tagOperation.tagName}」`;
    title.appendChild(name);
  }
  return title;
}

function renderTagTarget(
  presentation: PermissionPresentation,
  requestId: string,
  registerControl: (control: HTMLButtonElement) => void,
): HTMLElement | null {
  const target = presentation.tagTarget;
  if (!target) return null;
  const container = document.createElement("div");
  container.className = "perm-tag-target";
  const regionId = `perm-tag-target-${requestId}`;
  let expanded = false;

  const disclosure = createButton({
    variant: "ghost",
    size: "sm",
    label: "展开",
    onClick: () => {
      expanded = !expanded;
      render();
      disclosure.focus();
    },
  });
  disclosure.classList.add("perm-tag-disclosure");
  disclosure.setAttribute("aria-controls", regionId);
  registerControl(disclosure);

  const render = () => {
    disclosure.textContent = expanded ? "收起" : "展开";
    disclosure.setAttribute("aria-expanded", String(expanded));
    if (expanded) {
      const heading = document.createElement("div");
      heading.className = "perm-tag-target-heading";
      heading.textContent = `目标文本 · ${target.availabilityLabel}`;
      const surface = document.createElement("div");
      surface.id = regionId;
      surface.className = "perm-tag-target-full";
      surface.tabIndex = 0;
      surface.setAttribute("role", "region");
      surface.setAttribute("aria-label", `标签“${target.tagName}”的目标文本${target.availabilityLabel}`);
      surface.textContent = target.text;
      container.replaceChildren(heading, surface, disclosure);
      return;
    }
    const compact = document.createElement("div");
    compact.id = regionId;
    compact.className = "perm-tag-target-compact";
    const label = document.createElement("span");
    label.className = "perm-tag-target-label";
    label.textContent = "目标：";
    const excerpt = document.createElement("span");
    excerpt.className = "perm-tag-target-excerpt";
    excerpt.textContent = `“${target.excerpt}”`;
    compact.append(label, excerpt);
    container.replaceChildren(compact, disclosure);
  };
  render();
  return container;
}

export function mountPermissionBubble(
  root: HTMLElement,
  onResolve?: (req: PermissionRequest, decision: "allow" | "deny", writeMode: WriteMode) => void | Promise<void>,
  onError?: (error: unknown) => void,
): {
  destroy: () => void;
  isOpen: () => boolean;
  reject: () => void;
  show: (req: PermissionRequest) => void;
  clear: (requestId?: string) => void;
} {
  root.classList.add("perm-bubble-root");
  const requests: PermissionRequest[] = [];
  let currentRequest: PermissionRequest | null = null;
  let currentPresentation: PermissionPresentation | null = null;
  let resolving = false;
  let allowControl: PermissionAllowButtonHandle | null = null;
  let cardControls: HTMLButtonElement[] = [];

  const dialog = createPermissionDialog({
    onResolve: (decision, mode) => resolve(decision, mode),
    onClose: () => {},
  });

  function setDisabled(disabled: boolean): void {
    for (const control of cardControls) control.disabled = disabled;
    allowControl?.setDisabled(disabled);
    dialog.setDisabled(disabled);
  }

  function clearSurface(): void {
    dialog.close(false);
    allowControl?.destroy();
    allowControl = null;
    cardControls = [];
    root.replaceChildren();
    currentRequest = null;
    currentPresentation = null;
    resolving = false;
  }

  function clearRequest(requestId?: string): void {
    if (requestId === undefined) {
      requests.splice(0);
      clearSurface();
      return;
    }
    const index = requests.findIndex((request) => request.request_id === requestId);
    if (index < 0) return;
    const wasCurrent = currentRequest?.request_id === requestId;
    requests.splice(index, 1);
    if (!wasCurrent) return;
    clearSurface();
    const next = requests[0];
    if (next) render(next);
  }

  function requestResolution(
    request: PermissionRequest,
    decision: "allow" | "deny",
    writeMode: WriteMode,
  ): Promise<void> {
    try {
      const operation = onResolve
        ? onResolve(request, decision, writeMode)
        : invoke("resolve_permission", { requestId: request.request_id, decision, writeMode });
      return Promise.resolve(operation).then(() => undefined);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function resolve(decision: "allow" | "deny", writeMode: WriteMode): void {
    if (!currentRequest || resolving) return;
    const request = currentRequest;
    resolving = true;
    setDisabled(true);
    const operation = requestResolution(request, decision, writeMode);
    operation.then(() => {
      clearRequest(request.request_id);
    }).catch((error) => {
      if (currentRequest?.request_id !== request.request_id) return;
      resolving = false;
      setDisabled(false);
      onError?.(error);
    });
  }

  function render(request: PermissionRequest): void {
    dialog.close(false);
    allowControl?.destroy();
    root.replaceChildren();
    currentRequest = request;
    currentPresentation = projectPermission(request);
    resolving = false;

    const card = document.createElement("section");
    card.className = "perm-card";
    card.setAttribute("aria-label", currentPresentation.title);
    const footer = document.createElement("div");
    footer.className = "perm-footer";
    const left = document.createElement("div");
    left.className = "perm-footer-left";
    const actions = document.createElement("div");
    actions.className = "perm-footer-actions";
    cardControls = [];
    if (currentPresentation.canView) {
      const view = createButton({
        variant: "ghost", size: "sm", label: "查看",
        onClick: () => {
          if (!currentRequest || !currentPresentation || resolving) return;
          dialog.open(currentRequest, currentPresentation);
        },
      });
      view.classList.add("perm-view");
      left.appendChild(view);
      cardControls.push(view);
    }
    const deny = createButton({ variant: "secondary", size: "sm", label: "拒绝", onClick: () => resolve("deny", "direct") });
    deny.classList.add("perm-deny");
    allowControl = createPermissionAllowButton({
      canSnapshot: currentPresentation.canSnapshot,
      disabled: false,
      resolve: (mode) => resolve("allow", mode),
    });
    actions.append(deny, allowControl.el);
    cardControls.push(deny);
    footer.append(left, actions);
    card.appendChild(renderTitle(currentPresentation));
    const tagTarget = renderTagTarget(currentPresentation, request.request_id, (control) => cardControls.push(control));
    if (tagTarget) card.appendChild(tagTarget);
    card.appendChild(footer);
    root.appendChild(card);
  }

  function show(request: PermissionRequest): void {
    if (requests.some((pending) => pending.request_id === request.request_id)) return;
    requests.push(request);
    if (!currentRequest) render(request);
  }

  return {
    destroy() {
      const inFlightRequestId = resolving ? currentRequest?.request_id : undefined;
      const abandoned = requests.filter((request) => request.request_id !== inFlightRequestId);
      clearRequest();
      dialog.destroy();
      root.classList.remove("perm-bubble-root");
      for (const request of abandoned) {
        void requestResolution(request, "deny", "direct").catch((error) => onError?.(error));
      }
    },
    isOpen: () => currentRequest !== null,
    reject: () => resolve("deny", "direct"),
    show,
    clear: clearRequest,
  };
}
