import { StateEffect, StateField } from "@codemirror/state";

export interface ImageSourceRange {
  from: number;
  to: number;
}

export const SetImageSourceEffect = StateEffect.define<ImageSourceRange | null>();

export const imageSourceField = StateField.define<ImageSourceRange | null>({
  create: () => null,
  update(value, tr) {
    let next = value && tr.docChanged
      ? { from: tr.changes.mapPos(value.from, 1), to: tr.changes.mapPos(value.to, -1) }
      : value;
    for (const effect of tr.effects) {
      if (effect.is(SetImageSourceEffect)) next = effect.value;
    }
    return next;
  },
});
