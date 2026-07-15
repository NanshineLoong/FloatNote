export type PopupViewState =
  | { kind: "actions" }
  | { kind: "translate-loading"; popupRequestId: string }
  | { kind: "translate-result"; text: string }
  | { kind: "translate-error"; message: string }
  | { kind: "question-editing"; draft: string }
  | { kind: "question-sending"; draft: string; popupRequestId: string }
  | { kind: "question-error"; draft: string; message: string }
  | { kind: "question-sent-warning"; message: string }
  | { kind: "dismiss" };

export interface PopupState {
  generationId: number;
  view: PopupViewState;
}

export type PopupAction =
  | { type: "payload"; generationId: number }
  | { type: "translate-start"; popupRequestId: string }
  | { type: "translate-success"; generationId: number; popupRequestId: string; text: string }
  | { type: "translate-error"; generationId: number; popupRequestId: string; message: string }
  | { type: "question-edit" }
  | { type: "question-draft"; draft: string }
  | { type: "question-send"; popupRequestId: string }
  | { type: "question-error"; generationId: number; popupRequestId: string; message: string }
  | { type: "question-sent-warning"; generationId: number; popupRequestId: string; message: string }
  | { type: "escape" }
  | { type: "back" };

export function createPopupState(generationId: number): PopupState {
  return { generationId, view: { kind: "actions" } };
}

function matches(state: PopupState, generationId: number, popupRequestId: string): boolean {
  return state.generationId === generationId
    && "popupRequestId" in state.view
    && state.view.popupRequestId === popupRequestId;
}

export function reducePopupState(state: PopupState, action: PopupAction): PopupState {
  switch (action.type) {
    case "payload":
      return createPopupState(action.generationId);
    case "translate-start":
      return state.view.kind === "actions"
        ? { ...state, view: { kind: "translate-loading", popupRequestId: action.popupRequestId } }
        : state;
    case "translate-success":
      return matches(state, action.generationId, action.popupRequestId)
        ? { ...state, view: { kind: "translate-result", text: action.text } }
        : state;
    case "translate-error":
      return matches(state, action.generationId, action.popupRequestId)
        ? { ...state, view: { kind: "translate-error", message: action.message } }
        : state;
    case "question-edit":
      return state.view.kind === "actions" ? { ...state, view: { kind: "question-editing", draft: "" } } : state;
    case "question-draft":
      return state.view.kind === "question-editing" || state.view.kind === "question-error"
        ? { ...state, view: { kind: "question-editing", draft: action.draft } }
        : state;
    case "question-send":
      return state.view.kind === "question-editing" && state.view.draft.trim()
        ? { ...state, view: { kind: "question-sending", draft: state.view.draft, popupRequestId: action.popupRequestId } }
        : state;
    case "question-error":
      return matches(state, action.generationId, action.popupRequestId) && state.view.kind === "question-sending"
        ? { ...state, view: { kind: "question-error", draft: state.view.draft, message: action.message } }
        : state;
    case "question-sent-warning":
      return matches(state, action.generationId, action.popupRequestId)
        ? { ...state, view: { kind: "question-sent-warning", message: action.message } }
        : state;
    case "back":
      if (state.view.kind === "translate-loading" || state.view.kind === "question-sending") return state;
      return { ...state, view: { kind: "actions" } };
    case "escape":
      if (state.view.kind === "question-sending") return state;
      if (state.view.kind === "question-editing" || state.view.kind === "question-error") {
        return { ...state, view: { kind: "actions" } };
      }
      return { ...state, view: { kind: "dismiss" } };
  }
}
