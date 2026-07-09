import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Local mirror of the permission://request payload emitted by Rust (agent.rs).
// Kept in sync manually with sidecar/src/protocol.ts EditPreview + the
// permission://request emit in handle_apply_edit.
export type EditPreviewDetail =
  | { kind: "diff"; hunks: string }
  | { kind: "tag_assign"; blockPreview: string; tagName: string; tagColor: string }
  | { kind: "tag_create"; tagName: string; tagColor: string }
  | { kind: "tag_delete"; tagName: string; markerCount: number };

export interface EditPreview {
  tool: string;
  summary: string;
  detail: EditPreviewDetail;
}

interface PermissionRequest {
  request_id: string;
  conversation_id: string;
  target: { kind: string; name?: string };
  tool_name: string;
  old_content: string;
  new_content: string;
  preview: EditPreview;
  can_snapshot: boolean;
}

/** 工具名 → 卡片标题（语义化中文标签，不暴露内部 tool 名）。 */
const TOOL_LABEL: Record<string, string> = {
  edit_note: "编辑文本",
  write_note: "编辑文本",
  set_tag: "设置标签",
  tag_create: "新建标签",
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

export function mountPermissionBubble(root: HTMLElement): { destroy: () => void } {
  root.classList.add("perm-bubble-root");
  let unlisten: UnlistenFn | null = null;
  let destroyed = false;

  function show(req: PermissionRequest) {
    root.replaceChildren();
    const card = renderPreviewCard(req.preview, req.can_snapshot);
    const allow = document.createElement("button");
    allow.textContent = "允许写入";
    const deny = document.createElement("button");
    deny.textContent = "拒绝";
    const select = card.querySelector<HTMLSelectElement>(".perm-mode")!;
    allow.addEventListener("click", () => {
      void invoke("resolve_permission", { requestId: req.request_id, decision: "allow", writeMode: select.value });
      root.replaceChildren();
    });
    deny.addEventListener("click", () => {
      void invoke("resolve_permission", { requestId: req.request_id, decision: "deny", writeMode: "direct" });
      root.replaceChildren();
    });
    root.append(card, allow, deny);
  }

  listen<PermissionRequest>("permission://request", (e) => show(e.payload)).then((un) => {
    if (destroyed) un(); else unlisten = un;
  });

  return {
    destroy() {
      destroyed = true;
      unlisten?.();
      root.classList.remove("perm-bubble-root");
      root.replaceChildren();
    },
  };
}
