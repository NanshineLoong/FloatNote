# Project Spaces — Plan 2: Project Navigation (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the note window project-centric — the topbar left becomes a project-space switcher (list / switch / create), and opening a project loads its `_inbox.md` into the existing editor.

**Architecture:** Reuse Plan 1's three Tauri commands (`list_projects`, `create_project`, `list_pieces`) via thin TS wrappers in `notes-state.ts`. The editor keeps its current binding model (`CurrentNote = { dir, entry }`); we simply point `entry` at the project's `_inbox.md` (exposed as a `NoteEntry` named `_inbox`) so the autosave / agent / version wiring keeps working untouched. The old flat-note center switcher and rename UI are removed; a project switcher dropdown (reusing the existing `.switch-menu` styles) takes the left slot, with an inline "新建项目" input.

**Tech Stack:** TypeScript + Vite frontend, Tauri 2 `invoke`, Vitest for the one pure helper. No backend changes (Plan 1 already shipped the commands).

---

## Scope & Non-Goals (this plan only)

In scope: project switcher dropdown (left), switch project, create project (inline-named), edit the project's `_inbox.md` raw markdown, sensible first-run (auto-create a default project when none exist).

Out of scope (later plans): Inbox block rendering (Plan 3), 成品 multi-file switcher + rename (Plan 4 — this is why we delete the current note switcher/rename now), 清单 panel (Plan 5), split layout (Plan 6), capture-into-inbox rewire (Plan 7). Legacy flat `.md` notes are **not** surfaced in this view; they remain on disk, unharmed, just unreachable from the topbar until later UX exists. This is an accepted Plan-2 limitation, not data loss.

## File Structure

- **Modify** `src/note/notes-state.ts` — add `ProjectEntry`, `INBOX_FILE`, pure `inboxPath` / `inboxEntry` helpers, and `listProjects` / `createProject` / `listPieces` invoke wrappers.
- **Create** `src/note/notes-state.test.ts` — Vitest for the pure `inboxPath` / `inboxEntry` helpers.
- **Modify** `src/note/topbar.ts` — replace the note switcher + rename with a project switcher button; new callbacks; `setProjectLabel`; drop `startRename` / `setNoteLabel` / `onRename` / `onToggleMenu` / `onNew`.
- **Modify** `src/note/main.ts` — project state (`rootDir`, `currentProject`), `openProject`, `openFirstOrCreate`, `showProjectSwitcher`, `startNewProject`; rewire `init` / `pickDir`; drop `newNote` / old `showSwitcher` / flat-note imports.
- **Modify** `src/styles.css` — `.project-name` button styling (+ dark variant), `.switch-new` footer item, `.switch-new-input` inline input.

---

## Task 1: Project wrappers + pure inbox-path helper (`notes-state.ts`)

**Files:**
- Modify: `src/note/notes-state.ts`
- Test: `src/note/notes-state.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/note/notes-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inboxPath, inboxEntry } from "./notes-state";

describe("inboxPath", () => {
  it("joins a POSIX project folder with _inbox.md", () => {
    expect(inboxPath("/Users/me/FloatNote/阅读笔记")).toBe(
      "/Users/me/FloatNote/阅读笔记/_inbox.md",
    );
  });

  it("joins a Windows project folder with a backslash", () => {
    expect(inboxPath("C:\\Users\\me\\FloatNote\\阅读笔记")).toBe(
      "C:\\Users\\me\\FloatNote\\阅读笔记\\_inbox.md",
    );
  });

  it("strips a trailing separator before joining", () => {
    expect(inboxPath("/Users/me/proj/")).toBe("/Users/me/proj/_inbox.md");
  });
});

describe("inboxEntry", () => {
  it("names the entry _inbox and points at the inbox file", () => {
    const entry = inboxEntry({ name: "阅读笔记", path: "/Users/me/proj" });
    expect(entry).toEqual({ name: "_inbox", path: "/Users/me/proj/_inbox.md" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- notes-state`
Expected: FAIL — `inboxPath` / `inboxEntry` are not exported.

- [ ] **Step 3: Implement the helpers and wrappers**

In `src/note/notes-state.ts`, after the existing `NoteEntry` interface (top of file), add:

```ts
export interface ProjectEntry {
  name: string;
  path: string;
}

export const INBOX_FILE = "_inbox.md";

/** Join a project folder path with its `_inbox.md`, choosing the separator from
 * the folder path so it stays correct on both Windows (`\\`) and POSIX (`/`). */
export function inboxPath(projectPath: string): string {
  const sep = projectPath.includes("\\") ? "\\" : "/";
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  return `${trimmed}${sep}${INBOX_FILE}`;
}

/** The editor binds to a project's Inbox file. Expose it as a `NoteEntry` named
 * `_inbox` so the existing editor / agent / version wiring keeps working. */
export function inboxEntry(project: ProjectEntry): NoteEntry {
  return { name: "_inbox", path: inboxPath(project.path) };
}
```

Then, after the existing `listNotes` / `readNote` wrappers, add the three command wrappers:

```ts
export async function listProjects(root: string): Promise<ProjectEntry[]> {
  return invoke<ProjectEntry[]>("list_projects", { root });
}

export async function createProject(root: string, name: string): Promise<ProjectEntry> {
  return invoke<ProjectEntry>("create_project", { root, name });
}

export async function listPieces(projectDir: string): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("list_pieces", { projectDir });
}
```

(Note: Tauri maps JS camelCase `projectDir` → Rust `project_dir`, matching the existing `rename_note` `{ oldName, newStem }` convention.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- notes-state`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/note/notes-state.ts src/note/notes-state.test.ts
git commit -m "feat(project): add project command wrappers + inboxPath helper"
```

---

## Task 2: Topbar becomes a project switcher (`topbar.ts`)

**Files:**
- Modify: `src/note/topbar.ts`

No unit test (DOM + window wiring); verified via build + `npm run tauri dev` in Task 5.

- [ ] **Step 1: Replace the `TopbarCallbacks` interface**

Replace the existing `TopbarCallbacks` interface (lines 3–8) with:

```ts
export interface TopbarCallbacks {
  /** 文件夹按钮：挑选工作目录（项目空间的根）。 */
  onPickDir: () => void;
  /** 项目名按钮：开/关项目空间下拉。 */
  onToggleProjects: (anchor: HTMLElement) => void;
  /** "+" 按钮：开下拉并直接进入"新建项目"输入态。 */
  onNewProject: (anchor: HTMLElement) => void;
}
```

Leave `TitlebarCallbacks` and `renderTitlebar` untouched.

- [ ] **Step 2: Rewrite `renderTopbar`**

Replace the whole `renderTopbar` function (current lines 29–55) with:

```ts
export function renderTopbar(root: HTMLElement, callbacks: TopbarCallbacks) {
  root.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <button class="dir-name" id="dir-name" title=""><i class="ph ph-folder"></i><span id="dir-label">-</span></button>
        <span class="sep">/</span>
        <button class="project-name" id="project-name" title="切换项目空间">
          <span id="project-label">-</span><i class="ph ph-caret-down"></i>
        </button>
      </div>
      <button class="new-btn" id="new-btn" title="新建项目"><i class="ph ph-plus"></i></button>
    </div>
  `;

  root.querySelector<HTMLElement>("#dir-name")!.onclick = callbacks.onPickDir;

  const projectButton = root.querySelector<HTMLElement>("#project-name")!;
  projectButton.onclick = () => callbacks.onToggleProjects(projectButton);

  root.querySelector<HTMLElement>("#new-btn")!.onclick = () =>
    callbacks.onNewProject(projectButton);
}
```

- [ ] **Step 3: Delete `startRename` and replace the label setters**

Delete the entire `startRename` function (current lines 57–102).

Replace `setNoteLabel` (current lines 110–112) with `setProjectLabel`; keep `setDirLabel` exactly as is:

```ts
export function setProjectLabel(name: string) {
  document.querySelector<HTMLElement>("#project-label")!.textContent = name;
}
```

- [ ] **Step 4: Type-check (will still fail until Task 3 updates `main.ts`)**

Run: `npx tsc --noEmit`
Expected: errors **only** in `src/note/main.ts` (it still imports `setNoteLabel` / passes `onRename` etc.). `topbar.ts` itself should report no errors. This confirms Task 2 is internally consistent; Task 3 fixes the call site.

- [ ] **Step 5: Commit**

```bash
git add src/note/topbar.ts
git commit -m "feat(project): topbar note switcher becomes project switcher"
```

---

## Task 3: Project state + switcher + new-project flow (`main.ts`)

**Files:**
- Modify: `src/note/main.ts`

- [ ] **Step 1: Update the imports**

Replace the `notes-state` import block (current lines 11–22) with:

```ts
import {
  createProject,
  getConfig,
  inboxEntry,
  listProjects,
  readNote,
  resolveStartDir,
  scheduleSave,
  setWorkingDir,
  type CurrentNote,
  type ProjectEntry,
} from "./notes-state";
```

Replace the topbar import (current line 24) with:

```ts
import { renderTitlebar, renderTopbar, setDirLabel, setProjectLabel } from "./topbar";
```

- [ ] **Step 2: Replace the state declarations**

Replace the state block (current lines 43–46) with:

```ts
const DEFAULT_PROJECT_NAME = "阅读笔记";

let rootDir = "";
let currentProject: ProjectEntry | null = null;
let current: CurrentNote | null = null;
let menuEl: HTMLElement | null = null;
/** AI 改写热刷新期间置位，避免编辑器变更回灌 autosave。 */
let applyingRemote = false;
```

- [ ] **Step 3: Replace `openNote` / `showSwitcher` / `pickDir` / `newNote`**

Replace the four functions `openNote`, `showSwitcher`, `pickDir`, `newNote` (current lines 91–144) with the project-oriented versions below. Keep `basename` and `closeMenu` as they are.

```ts
async function openProject(project: ProjectEntry) {
  currentProject = project;
  const entry = inboxEntry(project);
  current = { dir: project.path, entry };
  setProjectLabel(project.name);
  setDoc(editor, await readNote(entry.path));
  // 发布活动笔记（= 当前项目的 _inbox.md），供独立助手窗 / apply_write 定位。
  void invoke("set_active_note", { dir: project.path, noteId: entry.name, path: entry.path });
}

async function openFirstOrCreate() {
  const projects = await listProjects(rootDir);
  const project = projects[0] ?? (await createProject(rootDir, DEFAULT_PROJECT_NAME));
  await openProject(project);
}

async function showProjectSwitcher(anchor: HTMLElement, startNew = false) {
  if (menuEl) {
    closeMenu();
    if (!startNew) return;
  }

  const projects = await listProjects(rootDir);
  menuEl = document.createElement("div");
  menuEl.className = "switch-menu";
  const rect = anchor.getBoundingClientRect();
  menuEl.style.left = `${rect.left}px`;
  menuEl.style.top = `${rect.bottom + 2}px`;

  for (const project of projects) {
    const item = document.createElement("button");
    item.className = "switch-item";
    item.textContent = project.name;
    if (currentProject && project.path === currentProject.path) item.classList.add("active");
    item.onclick = async () => {
      closeMenu();
      await openProject(project);
    };
    menuEl.appendChild(item);
  }

  const newItem = document.createElement("button");
  newItem.className = "switch-item switch-new";
  newItem.innerHTML = `<i class="ph ph-plus"></i> 新建项目`;
  newItem.onclick = (e) => {
    e.stopPropagation();
    startNewProject(newItem);
  };
  menuEl.appendChild(newItem);

  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);

  if (startNew) startNewProject(newItem);
}

function startNewProject(item: HTMLElement) {
  const input = document.createElement("input");
  input.className = "switch-new-input";
  input.placeholder = "项目名称";
  item.replaceWith(input);
  input.focus();
  // 阻止"点击外部关闭"在自己的输入框上触发。
  input.addEventListener("click", (e) => e.stopPropagation());

  let submitting = false;
  async function confirm() {
    if (submitting) return;
    const name = input.value.trim();
    if (!name) {
      closeMenu();
      return;
    }
    submitting = true;
    const project = await createProject(rootDir, name);
    closeMenu();
    await openProject(project);
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void confirm(); }
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
  });
}

async function pickDir() {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  await setWorkingDir(picked);
  rootDir = picked;
  setDirLabel(basename(picked), picked);
  await openFirstOrCreate();
}
```

- [ ] **Step 4: Rewire the `renderTopbar` call**

Replace the `renderTopbar(...)` call (current lines 149–163) with:

```ts
renderTopbar(document.querySelector("#topbar-root")!, {
  onPickDir: pickDir,
  onToggleProjects: (anchor) => {
    void showProjectSwitcher(anchor);
  },
  onNewProject: (anchor) => {
    void showProjectSwitcher(anchor, true);
  },
});
```

- [ ] **Step 5: Rewire `init`**

Replace the `init` function body (current lines 235–247) with:

```ts
async function init() {
  const config = await getConfig();
  applyFontSize(config.font_size);
  rootDir = await resolveStartDir(config);
  setDirLabel(basename(rootDir), rootDir);
  await openFirstOrCreate();

  const assistant = await invoke<{ open: boolean }>("get_assistant_state");
  layoutController = createLayoutController(app, { open: assistant.open });
  layoutController.apply();
}
```

- [ ] **Step 6: Type-check the whole frontend**

Run: `npx tsc --noEmit`
Expected: PASS, no errors. (Confirms `setNoteLabel` / `listNotes` / `createNote` / `renameNote` are no longer referenced.)

- [ ] **Step 7: Run the unit tests**

Run: `npm test`
Expected: PASS — existing `append` / `layout` / `versions` suites plus the new `notes-state` suite all green.

- [ ] **Step 8: Commit**

```bash
git add src/note/main.ts
git commit -m "feat(project): wire project switcher + new-project flow in note window"
```

---

## Task 4: Styles for the project switcher (`styles.css`)

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add light-mode styles**

Immediately after the `.topbar .sep { ... }` rule (current lines 225–227), add:

```css
.topbar .project-name {
  max-width: 220px;
  font-weight: 500;
}

.topbar .project-name:hover {
  background: rgba(0, 0, 0, 0.06);
}
```

After the `.switch-item.active { ... }` rule (current lines 368–370), add:

```css
.switch-item.switch-new {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  color: #2563eb;
}

.switch-new-input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 4px;
  padding: 6px 10px;
  border: 1px solid #2563eb;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: 13px;
  outline: none;
}
```

- [ ] **Step 2: Add dark-mode styles**

Inside the `@media (prefers-color-scheme: dark)` block, after the `.topbar .dir-name:hover { ... }` rule (current lines 432–434), add:

```css
  .topbar .project-name:hover {
    background: rgba(255, 255, 255, 0.08);
  }
```

After the dark `.switch-item:hover { ... }` rule (current lines 476–478), add:

```css
  .switch-item.switch-new {
    border-top-color: rgba(255, 255, 255, 0.1);
    color: #60a5fa;
  }

  .switch-new-input {
    border-color: #60a5fa;
    background: #2a2a2a;
    color: #d1d5db;
  }
```

- [ ] **Step 3: Build to confirm CSS + bundle are valid**

Run: `npm run build`
Expected: PASS — `tsc` clean and Vite bundles both entry pages.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "style(project): style the project switcher dropdown + new-project input"
```

---

## Task 5: Manual verification & backend sanity

**Files:** none (verification only)

- [ ] **Step 1: Backend still compiles**

Run: `cd src-tauri && cargo check`
Expected: PASS (no backend changes this plan; confirms nothing drifted).

- [ ] **Step 2: Run the app**

Run: `npm run tauri dev`

Verify, in order:
1. First launch on a fresh working dir auto-creates a project (folder `阅读笔记/` with `_inbox.md` / `_tasks.md` / `piece.md`) and opens its empty Inbox; topbar left shows `📁 <root> / 阅读笔记 ▾`.
2. Typing in the editor writes to `<project>/_inbox.md` (check the file on disk after ~1s autosave).
3. Clicking the project name opens the dropdown listing projects; clicking `+ 新建项目` reveals an inline input; entering a name creates a new project folder and switches to its (empty) Inbox.
4. The `+` button in the topbar opens the dropdown straight into new-project input mode.
5. Switching back to the first project re-loads its Inbox content.
6. The folder button still re-picks the working dir and re-lists projects under it.

- [ ] **Step 3: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "chore(project): plan 2 verification tweaks"
```

(Skip if nothing changed.)

---

## Self-Review

- **Spec coverage (roadmap Plan 2):** "topbar left → project-space switcher (list folders / switch / create)" → Tasks 2–4. "on open, load the project's `_inbox.md` as the current document" → `openProject` (Task 3) + `inboxEntry` (Task 1). "New-project flow calls `create_project`" → `startNewProject` (Task 3) + `createProject` wrapper (Task 1). "Touches `main.ts`, `topbar.ts`, `notes-state.ts`" → all three modified.
- **Placeholder scan:** every code step contains full code; no TBD/TODO; the one "verification tweaks" commit is explicitly conditional.
- **Type consistency:** `ProjectEntry { name, path }` defined in Task 1 and imported in Task 3; `inboxEntry` returns `NoteEntry { name, path }` consumed by `CurrentNote`; topbar exports `setProjectLabel` / `onToggleProjects` / `onNewProject` consistently between Tasks 2 and 3; `showProjectSwitcher(anchor, startNew=false)` signature matches both call sites.
- **Known limitation (documented above):** legacy flat notes are not surfaced in this view; deferred to a later plan, not lost on disk.
