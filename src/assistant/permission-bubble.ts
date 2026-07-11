import { invoke } from "@tauri-apps/api/core";
import { createButton } from "../shared/ui/button";

// Local mirror of the permission://request payload emitted by Rust (agent.rs).
// Kept in sync manually with sidecar/src/protocol.ts EditPreview + the
// permission://request emit in handle_apply_edit.
export type EditPreviewDetail =
  | { kind: "diff"; hunks: string }
  | { kind: "tag_assign"; blockPreview: string; tagName: string; tagColor: string }
  | { kind: "tag_create"; tagName: string; tagColor: string }
  | { kind: "tag_update"; tagId: string; oldName: string; oldColor: string; newName: string; newColor: string }
  | { kind: "note_create"; filename: string; contentPreview: string }
  | { kind: "tag_delete"; tagName: string; markerCount: number };

export interface EditPreview {
  tool: string;
  summary: string;
  detail: EditPreviewDetail;
}

/** 写入模式：直接写入 / 保存快照后写入。与 sidecar `resolve_permission` 的 writeMode 对齐。 */
export type WriteMode = "direct" | "snapshot";

export interface PermissionRequest {
  request_id: string;
  conversation_id: string;
  tool_call_id?: string;
  /** 目标笔记；缺省（target 省略）= 当前活动笔记。仅当 Rust 解析出显式 target 时存在。 */
  target?: { kind: string; name?: string };
  tool_name: string;
  old_content: string;
  new_content: string;
  preview: EditPreview;
  can_snapshot: boolean;
}

/** 工具名 → 卡片标题（语义化中文标签，不暴露内部 tool 名）。 */
export const TOOL_LABEL: Record<string, string> = {
  read_note: "读取笔记",
  list_tags: "列出标签",
  list_notes: "列出笔记",
  web_search: "搜索网页",
  web_fetch: "读取网页",
  read_skill: "读取技能",
  edit_note: "编辑文本",
  write_note: "编辑文本",
  set_tag: "设置标签",
  tag_create: "新建标签",
  tag_update: "修改标签",
  create_note: "创建文档",
  tag_delete: "删除标签",
};

/** 渲染单张 preview 卡片（纯 DOM，便于测试）。 */
export function renderPreviewCard(preview: EditPreview, canSnapshot: boolean): HTMLElement {
  const card = document.createElement("div");
  card.className = "perm-card";
  const title = document.createElement("div");
  title.className = "perm-title";
  title.textContent = TOOL_LABEL[preview.tool] ?? preview.tool;
  card.appendChild(title);
  if (preview.summary) {
    const summary = document.createElement("div");
    summary.className = "perm-summary";
    summary.textContent = preview.summary;
    card.appendChild(summary);
  }
  const detail = document.createElement("div");
  detail.className = "perm-detail";
  switch (preview.detail.kind) {
    case "diff": {
      const pre = document.createElement("pre");
      pre.textContent = preview.detail.hunks;
      detail.appendChild(pre);
      break;
    }
    case "tag_assign": {
      const row = document.createElement("div");
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.style.background = preview.detail.tagColor;
      chip.textContent = preview.detail.tagName;
      row.append("块「" + preview.detail.blockPreview + "」→ ", chip);
      detail.appendChild(row);
      break;
    }
    case "tag_create": {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.style.background = preview.detail.tagColor;
      chip.textContent = preview.detail.tagName;
      detail.append("新建标签 ", chip);
      break;
    }
    case "tag_update": {
      detail.textContent = `标签「${preview.detail.oldName}」→「${preview.detail.newName}」`;
      break;
    }
    case "note_create": {
      const name = document.createElement("strong");
      name.textContent = preview.detail.filename;
      const pre = document.createElement("pre");
      pre.textContent = preview.detail.contentPreview;
      detail.append("创建文档 ", name, pre);
      break;
    }
    case "tag_delete": {
      detail.textContent = `删除标签「${preview.detail.tagName}」，${preview.detail.markerCount} 处标记将清除`;
      break;
    }
  }
  card.appendChild(detail);
  const select = document.createElement("select");
  select.className = "perm-mode";
  const direct = document.createElement("option");
  direct.value = "direct";
  direct.textContent = "直接写入";
  select.appendChild(direct);
  if (canSnapshot) {
    const snap = document.createElement("option");
    snap.value = "snapshot";
    snap.textContent = "保存快照后写入";
    select.appendChild(snap);
  }
  card.appendChild(select);
  return card;
}

export function mountPermissionBubble(
  root: HTMLElement,
  onResolve?: (req: PermissionRequest, decision: "allow" | "deny", writeMode: WriteMode) => void | Promise<void>,
): {
  destroy: () => void;
  isOpen: () => boolean;
  reject: () => void;
  show: (req: PermissionRequest) => void;
  clear: () => void;
} {
  root.classList.add("perm-bubble-root");
  let currentReq: PermissionRequest | null = null;

  function clearBubble() {
    root.replaceChildren();
    currentReq = null;
  }

  function resolve(decision: "allow" | "deny", writeMode: WriteMode) {
    if (!currentReq) return;
    const req = currentReq;
    if (onResolve) {
      for (const control of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) control.disabled = true;
      Promise.resolve(onResolve(req, decision, writeMode)).then(clearBubble).catch(() => {
        for (const control of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) control.disabled = false;
      });
    } else {
      void invoke("resolve_permission", { requestId: req.request_id, decision, writeMode });
      clearBubble();
    }
  }

  function show(req: PermissionRequest) {
    root.replaceChildren();
    currentReq = req;
    const card = renderPreviewCard(req.preview, req.can_snapshot);
    const select = card.querySelector<HTMLSelectElement>(".perm-mode")!;
    const allow = createButton({
      variant: "primary",
      label: "允许写入",
      onClick: () => resolve("allow", select.value as WriteMode),
    });
    const deny = createButton({
      variant: "secondary",
      label: "拒绝",
      onClick: () => resolve("deny", "direct"),
    });
    root.append(card, allow, deny);
  }

  return {
    destroy() {
      root.classList.remove("perm-bubble-root");
      root.replaceChildren();
      currentReq = null;
    },
    isOpen() {
      return root.childNodes.length > 0;
    },
    reject() {
      resolve("deny", "direct");
    },
    show,
    clear: clearBubble,
  };
}
