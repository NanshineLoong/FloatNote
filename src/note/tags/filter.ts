/**
 * Tag filter — when a tag is active, every block WITHOUT that tag's marker is
 * hidden by a block-level replace decoration. The filtered view is read-only:
 * editing a partial projection of the Markdown can otherwise delete structural
 * separators or merge blocks that are not adjacent in the full document.
 * Clicking the same disc again or the "全部" control clears the filter.
 */
import { EditorState, StateEffect, StateField, RangeSetBuilder, type Extension, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { blockTagIds, type BlockRange } from "@floatnote/note-logic";

export const setTagFilter = StateEffect.define<string | null>();

interface TagFilterState {
  active: string | null;
  decorations: DecorationSet;
}

/** Current filter tag id plus direct layout-affecting decorations. */
const tagFilterField = StateField.define<TagFilterState>({
  create: () => ({ active: null, decorations: Decoration.none }),
  update(value, tr) {
    let active = value.active;
    let shouldRebuild = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(setTagFilter)) {
        active = e.value;
        shouldRebuild = true;
      }
    }
    if (!shouldRebuild) return value;
    return {
      active,
      decorations: buildFilter(tr.newDoc, active),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Block ranges that should be collapsed when `activeId` is the filter (pure,
 *  testable). null → none. */
export function hiddenBlockRanges(text: string, activeId: string | null): BlockRange[] {
  if (activeId === null) return [];
  const out: BlockRange[] = [];
  for (const { range, id } of blockTagIds(text)) {
    if (id !== activeId) out.push(range);
  }
  return out;
}

const COLLAPSE = Decoration.replace({ block: true });

function buildFilter(doc: Text, active: string | null): DecorationSet {
  if (active === null) return Decoration.none;
  const text = doc.toString();
  const entries: Array<{ from: number; to: number; deco: Decoration }> = [];
  for (const r of hiddenBlockRanges(text, active)) {
    const from = doc.lineAt(r.from).from;
    const lastLine = doc.lineAt(Math.min(r.to, doc.length));
    const to = Math.min(lastLine.to + 1, doc.length);
    entries.push({ from, to, deco: COLLAPSE });
  }
  entries.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const e of entries) builder.add(e.from, e.to, e.deco);
  return builder.finish();
}

export function activeTagFilter(state: EditorState): string | null {
  return state.field(tagFilterField).active;
}

/** Dispatch a filter change (null = show all). */
export function setTagFilterEffect(view: EditorView, id: string | null): void {
  view.dispatch({ effects: setTagFilter.of(id) });
}

export function tagFilter(): Extension[] {
  return [
    tagFilterField,
    EditorState.readOnly.compute([tagFilterField], (state) =>
      activeTagFilter(state) !== null,
    ),
  ];
}
