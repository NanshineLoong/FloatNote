// @vitest-environment jsdom
import { undo } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { createEditor, requestEditorLayout, setDoc } from "./editor";

describe("requestEditorLayout", () => {
  it("requests a CodeMirror measurement on the next frame", () => {
    const requestMeasure = vi.fn();
    const schedule = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    requestEditorLayout({ requestMeasure }, schedule);

    expect(schedule).toHaveBeenCalledOnce();
    expect(requestMeasure).toHaveBeenCalledOnce();
  });
});

describe("setDoc undo", () => {
  it("setDoc is undoable in-session (AI write can be reverted with ⌘Z)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = createEditor(host, () => {});

    // Seed the original document WITHOUT recording history, so the only
    // history-tracked transaction is the AI write below.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "原文" },
      annotations: Transaction.addToHistory.of(false),
    });

    setDoc(view, "AI 改写后");
    expect(view.state.doc.toString()).toBe("AI 改写后");

    undo(view);
    expect(view.state.doc.toString()).toBe("原文");
  });
});
