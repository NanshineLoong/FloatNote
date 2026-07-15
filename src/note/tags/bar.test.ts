// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mountTagBar, nextTagFilter } from "./bar";
import { inboxMetadataExtension, replaceInboxMetadata } from "../annotations/state";
import { tagFilter } from "./filter";

const source = readFileSync(resolve(process.cwd(), "src/note/tags/bar.ts"), "utf8");

describe("nextTagFilter", () => {
  it("activates the clicked tag when no filter is active", () => {
    expect(nextTagFilter(null, "todo")).toBe("todo");
  });

  it("clears the filter when the active tag is clicked again", () => {
    expect(nextTagFilter("todo", "todo")).toBeNull();
  });

  it("switches from one tag to another", () => {
    expect(nextTagFilter("todo", "idea")).toBe("idea");
  });
});

describe("tag bar read-only status", () => {
  it("renders a right-aligned read-only hint while a tag filter is active", () => {
    expect(source).toContain("tag-readonly-hint");
    expect(source).toContain("只读视图");
    expect(source).toContain("ph-lock");
  });
});

describe("tag bar visibility", () => {
  it("hides when its final tag is deleted", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ extensions: [...inboxMetadataExtension(), ...tagFilter()] }),
    });
    const tagBar = mountTagBar(view);

    expect(tagBar.el.classList).toContain("tag-bar--hidden");

    view.dispatch({ effects: replaceInboxMetadata.of({
      tags: [{ id: "idea", name: "Idea", color: "#3b82f6" }],
      annotations: [],
      quoteSources: [],
    }) });
    tagBar.refresh();
    expect(tagBar.el.classList).not.toContain("tag-bar--hidden");

    view.dispatch({ effects: replaceInboxMetadata.of({ tags: [], annotations: [], quoteSources: [] }) });
    tagBar.refresh();
    expect(tagBar.el.classList).toContain("tag-bar--hidden");

    view.destroy();
    parent.remove();
  });
});
