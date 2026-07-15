import { describe, expect, it } from "vitest";
import { createPopupState, reducePopupState } from "./state";

describe("popup state", () => {
  it("resets transient state for a new generation", () => {
    let state = createPopupState(1);
    state = reducePopupState(state, { type: "question-edit" });
    state = reducePopupState(state, { type: "question-draft", draft: "why?" });
    state = reducePopupState(state, { type: "payload", generationId: 2 });
    expect(state).toEqual({ generationId: 2, view: { kind: "actions" } });
  });

  it("ignores stale translation results by generation and request", () => {
    let state = createPopupState(2);
    state = reducePopupState(state, { type: "translate-start", popupRequestId: "r2" });
    const staleGeneration = reducePopupState(state, {
      type: "translate-success", generationId: 1, popupRequestId: "r2", text: "old",
    });
    const staleRequest = reducePopupState(state, {
      type: "translate-success", generationId: 2, popupRequestId: "r1", text: "old",
    });
    expect(staleGeneration).toBe(state);
    expect(staleRequest).toBe(state);
    expect(reducePopupState(state, {
      type: "translate-success", generationId: 2, popupRequestId: "r2", text: "new",
    }).view).toEqual({ kind: "translate-result", text: "new" });
  });

  it("preserves the question draft on send failure and returns to actions on escape", () => {
    let state = createPopupState(3);
    state = reducePopupState(state, { type: "question-edit" });
    state = reducePopupState(state, { type: "question-draft", draft: "why?" });
    state = reducePopupState(state, { type: "question-send", popupRequestId: "q1" });
    state = reducePopupState(state, {
      type: "question-error", generationId: 3, popupRequestId: "q1", message: "failed",
    });
    expect(state.view).toEqual({ kind: "question-error", draft: "why?", message: "failed" });
    expect(reducePopupState(state, { type: "escape" }).view).toEqual({ kind: "actions" });
  });

  it("marks escape from actions as a dismissal", () => {
    expect(reducePopupState(createPopupState(1), { type: "escape" }).view).toEqual({ kind: "dismiss" });
  });

  it("does not unlock a question while its send handshake is in flight", () => {
    let state = createPopupState(1);
    state = reducePopupState(state, { type: "question-edit" });
    state = reducePopupState(state, { type: "question-draft", draft: "why" });
    state = reducePopupState(state, { type: "question-send", popupRequestId: "q1" });
    expect(reducePopupState(state, { type: "escape" })).toBe(state);
  });

  it("dismisses translation views instead of enabling a second request", () => {
    const loading = reducePopupState(createPopupState(1), { type: "translate-start", popupRequestId: "t1" });
    expect(reducePopupState(loading, { type: "escape" }).view).toEqual({ kind: "dismiss" });
  });
});
