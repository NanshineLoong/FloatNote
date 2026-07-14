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

export type WriteMode = "direct" | "snapshot";

export interface PermissionRequest {
  request_id: string;
  conversation_id: string;
  tool_call_id?: string;
  target?: { kind: string; name?: string };
  tool_name: string;
  old_content: string;
  new_content: string;
  preview: EditPreview;
  can_snapshot: boolean;
  resolved_note_id?: string;
  resolved_path?: string;
}

export interface PermissionPresentation {
  title: string;
  canView: boolean;
  canSnapshot: boolean;
  colors: Array<{ label: string; color: string }>;
}

function basename(path: string | undefined): string | undefined {
  const value = path?.split(/[\\/]/).filter(Boolean).at(-1)?.trim();
  return value || undefined;
}

function documentName(request: PermissionRequest): string {
  return basename(request.resolved_path)
    ?? basename(request.target?.name)
    ?? basename(request.resolved_note_id)
    ?? (request.preview.detail.kind === "note_create" ? basename(request.preview.detail.filename) : undefined)
    ?? "当前文档";
}

export function projectPermission(request: PermissionRequest): PermissionPresentation {
  const detail = request.preview.detail;
  const colors: PermissionPresentation["colors"] = [];
  let title: string;
  switch (request.tool_name) {
    case "create_note": title = `创建「${documentName(request)}」`; break;
    case "edit_note": title = `编辑「${documentName(request)}」`; break;
    case "write_note": title = `覆写「${documentName(request)}」`; break;
    case "tag_create": {
      const d = detail.kind === "tag_create" ? detail : null;
      title = `新建标签「${d?.tagName ?? "未命名"}」`;
      if (d?.tagColor) colors.push({ label: d.tagName, color: d.tagColor });
      break;
    }
    case "set_tag": {
      const d = detail.kind === "tag_assign" ? detail : null;
      title = d?.tagName
        ? `为「${d.blockPreview}」设置标签「${d.tagName}」`
        : `清除「${d?.blockPreview ?? "块"}」的标签`;
      if (d?.tagName && d.tagColor) colors.push({ label: d.tagName, color: d.tagColor });
      break;
    }
    case "tag_update": {
      const d = detail.kind === "tag_update" ? detail : null;
      title = d ? `修改标签「${d.oldName}」→「${d.newName}」` : "修改标签";
      if (d?.oldColor) colors.push({ label: `原颜色：${d.oldName}`, color: d.oldColor });
      if (d?.newColor) colors.push({ label: `新颜色：${d.newName}`, color: d.newColor });
      break;
    }
    case "tag_delete": {
      const d = detail.kind === "tag_delete" ? detail : null;
      title = d ? `删除标签「${d.tagName}」并清除 ${d.markerCount} 处标记` : "删除标签";
      break;
    }
    default: title = request.preview.summary || "写入变更";
  }
  return {
    title,
    canView: ["create_note", "edit_note", "write_note"].includes(request.tool_name),
    canSnapshot: request.tool_name === "write_note" && request.can_snapshot,
    colors,
  };
}
