import { createButton } from "../shared/ui/button";
import { createModalPaper } from "../shared/ui/modal-paper";
import { fillMarkdown } from "./markdown";
import { createPermissionAllowButton, type PermissionAllowButtonHandle } from "./permission-allow-button";
import { buildDiffRows, foldDiffRows, type DiffRow } from "./permission-diff";
import type { PermissionPresentation, PermissionRequest, WriteMode } from "./permission-model";

export interface PermissionDialogOptions {
  onResolve: (decision: "allow" | "deny", writeMode: WriteMode) => void;
  onClose: () => void;
}

export interface PermissionDialogHandle {
  open: (request: PermissionRequest, presentation: PermissionPresentation) => void;
  close: (restoreFocus?: boolean) => void;
  isOpen: () => boolean;
  setDisabled: (disabled: boolean) => void;
  destroy: () => void;
}

export function createPermissionDialog(options: PermissionDialogOptions): PermissionDialogHandle {
  let allow: PermissionAllowButtonHandle | null = null;
  let deny: HTMLButtonElement | null = null;
  let closeButton: HTMLButtonElement | null = null;
  let tabButtons: HTMLButtonElement[] = [];
  const modal = createModalPaper({
    ariaLabel: "写入审查",
    layerClass: "perm-dialog",
    backdropClass: "perm-dialog-backdrop",
    paperClass: "perm-dialog-paper",
    onEscape: () => handle.close(),
  });

  function renderDiffRow(row: Exclude<DiffRow, { kind: "collapsed" }>): HTMLElement {
    const element = document.createElement("div");
    element.className = `perm-diff-row is-${row.kind}`;
    element.setAttribute("aria-label", row.kind === "added" ? "新增行" : row.kind === "removed" ? "删除行" : row.kind === "replaced" ? "修改行" : "未修改行");
    const oldCell = document.createElement("div");
    oldCell.className = "perm-diff-cell perm-diff-old";
    oldCell.textContent = row.oldText;
    const newCell = document.createElement("div");
    newCell.className = "perm-diff-cell perm-diff-new";
    newCell.textContent = row.newText;
    element.append(oldCell, newCell);
    return element;
  }

  function renderDiff(request: PermissionRequest): HTMLElement {
    const scroll = document.createElement("div");
    scroll.className = "perm-diff-scroll";
    const grid = document.createElement("div");
    grid.className = "perm-diff";
    const oldLabel = document.createElement("div");
    oldLabel.className = "perm-diff-label perm-diff-old-label";
    oldLabel.textContent = "原版本";
    const newLabel = document.createElement("div");
    newLabel.className = "perm-diff-label perm-diff-new-label";
    newLabel.textContent = "新版本";
    grid.append(oldLabel, newLabel);
    for (const row of foldDiffRows(buildDiffRows(request.old_content, request.new_content))) {
      if (row.kind !== "collapsed") {
        grid.appendChild(renderDiffRow(row));
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "perm-diff-collapsed";
      button.textContent = `… 省略 ${row.rows.length} 行未修改内容`;
      button.setAttribute("aria-label", `展开 ${row.rows.length} 行未修改内容`);
      button.addEventListener("click", () => button.replaceWith(...row.rows.map(renderDiffRow)));
      grid.appendChild(button);
    }
    scroll.appendChild(grid);
    return scroll;
  }

  function renderBody(request: PermissionRequest): HTMLElement {
    const body = document.createElement("div");
    body.className = "perm-dialog-body";
    if (request.tool_name === "create_note") {
      const article = document.createElement("article");
      article.className = "perm-dialog-markdown";
      if (request.new_content) fillMarkdown(article, request.new_content);
      else {
        const empty = document.createElement("div");
        empty.className = "perm-dialog-empty";
        empty.textContent = "空文档";
        article.appendChild(empty);
      }
      body.appendChild(article);
      return body;
    }
    const tabs = document.createElement("div");
    body.classList.add("has-tabs");
    tabs.className = "perm-review-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "审查视图");
    const panel = document.createElement("div");
    panel.className = "perm-review-panel";
    panel.id = `perm-review-panel-${request.request_id}`;
    panel.setAttribute("role", "tabpanel");
    const diffTab = document.createElement("button");
    diffTab.type = "button";
    diffTab.className = "perm-review-tab";
    diffTab.setAttribute("role", "tab");
    diffTab.setAttribute("aria-controls", panel.id);
    diffTab.textContent = "变更";
    const previewTab = document.createElement("button");
    previewTab.type = "button";
    previewTab.className = "perm-review-tab";
    previewTab.setAttribute("role", "tab");
    previewTab.setAttribute("aria-controls", panel.id);
    previewTab.textContent = "新版本预览";

    const showDiff = () => {
      diffTab.setAttribute("aria-selected", "true");
      diffTab.tabIndex = 0;
      previewTab.setAttribute("aria-selected", "false");
      previewTab.tabIndex = -1;
      try {
        panel.replaceChildren(renderDiff(request));
      } catch {
        const fallback = document.createElement("div");
        fallback.className = "perm-diff-fallback";
        for (const [label, content] of [["原版本", request.old_content], ["新版本", request.new_content]] as const) {
          const column = document.createElement("section");
          const heading = document.createElement("h3");
          heading.textContent = label;
          const pre = document.createElement("pre");
          pre.textContent = content;
          column.append(heading, pre);
          fallback.appendChild(column);
        }
        panel.replaceChildren(fallback);
      }
    };
    const showPreview = () => {
      diffTab.setAttribute("aria-selected", "false");
      diffTab.tabIndex = -1;
      previewTab.setAttribute("aria-selected", "true");
      previewTab.tabIndex = 0;
      const article = document.createElement("article");
      article.className = "perm-dialog-markdown";
      if (request.new_content) fillMarkdown(article, request.new_content);
      else article.textContent = "空文档";
      panel.replaceChildren(article);
    };
    diffTab.addEventListener("click", showDiff);
    previewTab.addEventListener("click", showPreview);
    diffTab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      showPreview();
      previewTab.focus();
    });
    previewTab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      showDiff();
      diffTab.focus();
    });
    tabs.append(diffTab, previewTab);
    tabButtons = [diffTab, previewTab];
    body.append(tabs, panel);
    showDiff();
    return body;
  }

  const handle: PermissionDialogHandle = {
    open(request, presentation) {
      if (modal.isOpen()) handle.close(false);
      allow?.destroy();
      allow = null;
      tabButtons = [];
      const header = document.createElement("header");
      header.className = "perm-dialog-header";
      const title = document.createElement("h2");
      title.className = "perm-dialog-title";
      title.id = `perm-dialog-title-${request.request_id}`;
      title.textContent = presentation.title;
      title.title = presentation.title;
      closeButton = createButton({ variant: "ghost", icon: "ph-x", iconOnly: true, label: "关闭审查", onClick: () => handle.close() });
      closeButton.classList.add("perm-dialog-close");
      header.append(title, closeButton);

      const footer = document.createElement("footer");
      footer.className = "perm-dialog-footer";
      deny = createButton({ variant: "secondary", label: "拒绝", onClick: () => options.onResolve("deny", "direct") });
      deny.classList.add("perm-deny");
      allow = createPermissionAllowButton({
        canSnapshot: presentation.canSnapshot,
        disabled: false,
        resolve: (mode) => options.onResolve("allow", mode),
        registerPortalRoot: modal.registerPortalRoot,
      });
      footer.append(deny, allow.el);
      modal.paper.replaceChildren(header, renderBody(request), footer);
      modal.layer.removeAttribute("aria-label");
      modal.layer.setAttribute("aria-labelledby", title.id);
      modal.open();
      closeButton.focus();
    },
    close(restoreFocus = true) {
      if (!modal.isOpen()) return;
      allow?.closeMenu();
      modal.close({ restoreFocus });
      options.onClose();
    },
    isOpen: modal.isOpen,
    setDisabled(disabled) {
      allow?.setDisabled(disabled);
      if (deny) deny.disabled = disabled;
      if (closeButton) closeButton.disabled = disabled;
      for (const tab of tabButtons) tab.disabled = disabled;
    },
    destroy() {
      allow?.destroy();
      allow = null;
      modal.destroy();
    },
  };
  return handle;
}
