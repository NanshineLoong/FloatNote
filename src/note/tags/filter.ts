import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export const setTagFilter = StateEffect.define<string | null>();

const tagFilterField = StateField.define<string | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTagFilter)) value = effect.value;
    }
    return value;
  },
});

export function activeTagFilter(state: EditorState): string | null {
  return state.field(tagFilterField);
}

export function setTagFilterEffect(view: EditorView, id: string | null): void {
  view.dispatch({ effects: setTagFilter.of(id) });
}

export function tagFilter(): Extension[] {
  return [tagFilterField];
}
