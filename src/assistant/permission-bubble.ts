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
  edit_note: "编辑文本", write_note: "编辑文本", set_tag: "设置标签",
  tag_create: "新建标签", tag_update: "修改标签", create_note: "创建文档", tag_delete: "删除标签",
};

function renderTitle(presentation: PermissionPresentation): HTMLElement {
  const title = document.createElement("div");
  title.className = "perm-title";
  title.title = presentation.title;
  const text = document.createElement("span");
  text.className = "perm-title-text";
  text.textContent = presentation.title;
  title.appendChild(text);
  for (const cue of presentation.colors) {
    const color = document.createElement("span");
    color.className = "perm-title-color";
    color.style.backgroundColor = cue.color;
    color.setAttribute("role", "img");
    color.setAttribute("aria-label", `${cue.label}，颜色 ${cue.color}`);
    color.title = `${cue.label}：${cue.color}`;
    title.appendChild(color);
  }
  return title;
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
  clear: () => void;
} {
  root.classList.add("perm-bubble-root");
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

  function clearBubble(): void {
    dialog.close(false);
    allowControl?.destroy();
    allowControl = null;
    cardControls = [];
    root.replaceChildren();
    currentRequest = null;
    currentPresentation = null;
    resolving = false;
  }

  function resolve(decision: "allow" | "deny", writeMode: WriteMode): void {
    if (!currentRequest || resolving) return;
    const request = currentRequest;
    resolving = true;
    setDisabled(true);
    const operation = onResolve
      ? Promise.resolve(onResolve(request, decision, writeMode))
      : Promise.resolve(invoke("resolve_permission", { requestId: request.request_id, decision, writeMode })).then(() => undefined);
    operation.then(() => {
      if (currentRequest?.request_id === request.request_id) clearBubble();
    }).catch((error) => {
      if (currentRequest?.request_id !== request.request_id) return;
      resolving = false;
      setDisabled(false);
      onError?.(error);
    });
  }

  function show(request: PermissionRequest): void {
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
    card.append(renderTitle(currentPresentation), footer);
    root.appendChild(card);
  }

  return {
    destroy() {
      clearBubble();
      dialog.destroy();
      root.classList.remove("perm-bubble-root");
    },
    isOpen: () => currentRequest !== null,
    reject: () => resolve("deny", "direct"),
    show,
    clear: clearBubble,
  };
}
