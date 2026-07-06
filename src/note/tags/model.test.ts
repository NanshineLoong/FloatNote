import { describe, it, expect } from "vitest";
import {
  parseDefs,
  serializeDefs,
  writeDefsChange,
  buildMarker,
  stripTagMarker,
  blockTagId,
  setBlockTagChange,
  addTagAndSetBlockChanges,
  addTagDefChange,
  patchTagDefChange,
  deleteTagChanges,
  isTagColorTaken,
  slugify,
  uniqueSlug,
} from "./model";

const def = (id: string, name: string, color: string) => ({ id, name, color });

describe("parseDefs / serializeDefs", () => {
  it("round-trips an empty map", () => {
    const map = new Map();
    expect(parseDefs(serializeDefs(map)).size).toBe(0);
  });
  it("round-trips multiple tags", () => {
    const map = new Map([
      ["concept", def("concept", "概念", "#e5484d")],
      ["todo", def("todo", "待办", "#f5a623")],
    ]);
    const doc = serializeDefs(map) + "\nbody";
    const back = parseDefs(doc);
    expect([...back.values()]).toEqual([...map.values()]);
  });
  it("treats a missing defs line as empty", () => {
    expect(parseDefs("just text\nhere").size).toBe(0);
  });
  it("is lenient on a malformed defs line", () => {
    expect(parseDefs("<!-- floatnote-tags: garbage -->\n").size).toBe(0);
  });
});

describe("writeDefsChange", () => {
  it("inserts a new line 1 when absent", () => {
    const map = new Map([["concept", def("concept", "概念", "#e5484d")]]);
    const c = writeDefsChange("body", map)!;
    expect(c).toEqual({ from: 0, to: 0, insert: serializeDefs(map) + "\n" });
  });
  it("replaces the existing defs line in place (newline preserved)", () => {
    const map = new Map([["concept", def("concept", "概念", "#e5484d")]]);
    const doc = `<!-- floatnote-tags: old="旧"|c=#000000 -->\nbody`;
    const c = writeDefsChange(doc, map)!;
    expect(c.from).toBe(0);
    // replace only the comment text, not the newline
    expect(c.to).toBe(doc.indexOf("\n"));
    expect(c.insert).toBe(serializeDefs(map));
  });
  it("removes the defs line + its newline when the map empties", () => {
    const doc = `<!-- floatnote-tags: concept="概念"|c=#e5484d -->\nbody`;
    const c = writeDefsChange(doc, new Map())!;
    expect(c).toEqual({ from: 0, to: doc.indexOf("\n") + 1, insert: "" });
  });
  it("returns null when the map is empty and there was no defs line", () => {
    expect(writeDefsChange("body", new Map())).toBeNull();
  });
});

describe("marker build / strip / read", () => {
  it("buildMarker wraps an id", () => {
    expect(buildMarker("concept")).toBe("<!-- floatnote:tag=concept -->");
  });
  it("stripTagMarker removes all markers", () => {
    expect(stripTagMarker("a<!-- floatnote:tag=x --> b<!-- floatnote:tag=y -->"))
      .toBe("a b");
  });
  it("blockTagId finds the first marker anywhere in the block (whole-block scan)", () => {
    const block = "> [!quote] chip\n> line\n> mid<!-- floatnote:tag=todo -->\n> end";
    expect(blockTagId(block)).toBe("todo");
  });
  it("blockTagId returns null when untagged", () => {
    expect(blockTagId("plain paragraph")).toBeNull();
  });
});

describe("setBlockTagChange", () => {
  const range = (doc: string) => {
    const r = { from: 0, to: doc.length };
    return r;
  };
  it("appends a marker at block end when none exists", () => {
    const doc = "hello";
    const c = setBlockTagChange(doc, range(doc), "concept")!;
    expect(c).toEqual({ from: 5, to: 5, insert: buildMarker("concept") });
  });
  it("replaces an existing marker's id in place", () => {
    const doc = `hello<!-- floatnote:tag=old -->`;
    const c = setBlockTagChange(doc, range(doc), "new")!;
    expect(c.from).toBe(5);
    expect(c.to).toBe(5 + buildMarker("old").length);
    expect(c.insert).toBe(buildMarker("new"));
  });
  it("clears an existing marker", () => {
    const doc = `hello<!-- floatnote:tag=x -->`;
    const c = setBlockTagChange(doc, range(doc), null)!;
    expect(c).toEqual({ from: 5, to: 5 + buildMarker("x").length, insert: "" });
  });
  it("clear is a no-op when no marker exists", () => {
    const doc = "hello";
    expect(setBlockTagChange(doc, range(doc), null)).toBeNull();
  });
  it("respects block range offsets (not just whole-doc)", () => {
    // A block that starts at offset 4 within a larger doc.
    const doc = "hdr\n\nhello";
    const r = { from: 5, to: 10 }; // "hello"
    const c = setBlockTagChange(doc, r, "concept")!;
    expect(c).toEqual({ from: 10, to: 10, insert: buildMarker("concept") });
  });
});

describe("addTagDefChange", () => {
  it("adds a tag with a slugified unique id", () => {
    const doc = `<!-- floatnote-tags: todo="待办"|c=#f5a623 -->\nbody`;
    const { id, change } = addTagDefChange(doc, "Concept", "#e5484d");
    expect(id).toBe("concept");
    const next = applyChange(doc, change);
    expect([...parseDefs(next).keys()]).toEqual(["todo", "concept"]);
  });
  it("falls back to 'tag' slug for non-ascii names", () => {
    const doc = `<!-- floatnote-tags: todo="待办"|c=#f5a623 -->\nbody`;
    const { id } = addTagDefChange(doc, "概念", "#e5484d");
    expect(id).toBe("tag");
  });
  it("uniquifies on slug collision", () => {
    const doc = `<!-- floatnote-tags: concept="A"|c=#e5484d -->\nbody`;
    const { id } = addTagDefChange(doc, "Concept", "#000");
    expect(id).toBe("concept-2");
  });
  it("rejects a color already used by another tag", () => {
    const doc = `<!-- floatnote-tags: concept="概念"|c=#e5484d -->\nbody`;
    const { id, change } = addTagDefChange(doc, "待办", "#E5484D");
    expect(id).toBeNull();
    expect(change).toBeNull();
  });
});

describe("addTagAndSetBlockChanges", () => {
  it("adds a tag definition and assigns it to the selected block in one change set", () => {
    const doc = "alpha\n\nbeta";
    const range = { from: 7, to: 11 };
    const { id, changes } = addTagAndSetBlockChanges(doc, range, "待处理", "#e5484d");
    let next = doc;
    for (const c of [...changes].sort((a, b) => b.from - a.from)) {
      next = next.slice(0, c.from) + (c.insert ?? "") + next.slice(c.to);
    }

    expect(id).toBe("tag");
    expect([...parseDefs(next).values()]).toEqual([
      { id: "tag", name: "待处理", color: "#e5484d" },
    ]);
    expect(next).toContain(`beta${buildMarker("tag")}`);
    expect(next).not.toContain(`alpha${buildMarker("tag")}`);
  });
  it("does not add or assign a tag when its color is already taken", () => {
    const doc = `<!-- floatnote-tags: concept="概念"|c=#e5484d -->\nalpha\n\nbeta`;
    const range = { from: doc.indexOf("beta"), to: doc.indexOf("beta") + 4 };
    const { id, changes } = addTagAndSetBlockChanges(doc, range, "待办", "#e5484d");
    expect(id).toBeNull();
    expect(changes).toEqual([]);
  });
});

describe("patchTagDefChange", () => {
  it("renames without touching markers (defs-only)", () => {
    const doc = `<!-- floatnote-tags: concept="A"|c=#e5484d -->\nbody<!-- floatnote:tag=concept -->`;
    const c = patchTagDefChange(doc, "concept", { name: "概念" })!;
    const next = applyChange(doc, c);
    expect(parseDefs(next).get("concept")!.name).toBe("概念");
    expect(next).toContain("<!-- floatnote:tag=concept -->"); // marker unchanged
  });
  it("recolors", () => {
    const doc = `<!-- floatnote-tags: concept="概念"|c=#e5484d -->\nbody`;
    const c = patchTagDefChange(doc, "concept", { color: "#3b82f6" })!;
    expect(parseDefs(applyChange(doc, c)).get("concept")!.color).toBe("#3b82f6");
  });
  it("does not recolor to another tag's color", () => {
    const doc = `<!-- floatnote-tags: concept="概念"|c=#e5484d; todo="待办"|c=#f5a623 -->\nbody`;
    expect(patchTagDefChange(doc, "todo", { color: "#E5484D" })).toBeNull();
  });
  it("allows a tag to keep its own color", () => {
    const doc = `<!-- floatnote-tags: concept="概念"|c=#e5484d; todo="待办"|c=#f5a623 -->\nbody`;
    const c = patchTagDefChange(doc, "concept", { color: "#E5484D" })!;
    expect(parseDefs(applyChange(doc, c)).get("concept")!.color).toBe("#E5484D");
  });
  it("returns null for an unknown id", () => {
    expect(patchTagDefChange("body", "nope", { name: "x" })).toBeNull();
  });
});

describe("isTagColorTaken", () => {
  it("checks color occupancy case-insensitively and can ignore one tag", () => {
    const map = new Map([
      ["concept", def("concept", "概念", "#e5484d")],
      ["todo", def("todo", "待办", "#f5a623")],
    ]);
    expect(isTagColorTaken(map, "#E5484D")).toBe(true);
    expect(isTagColorTaken(map, "#E5484D", "concept")).toBe(false);
    expect(isTagColorTaken(map, "#3b82f6")).toBe(false);
  });
});

describe("deleteTagChanges", () => {
  it("removes all markers + the defs entry in one sorted change set", () => {
    const doc =
      `<!-- floatnote-tags: concept="概念"|c=#e5484d; todo="待办"|c=#f5a623 -->\n` +
      `a<!-- floatnote:tag=concept -->\n\nb<!-- floatnote:tag=todo -->\n\nc<!-- floatnote:tag=concept -->`;
    const changes = deleteTagChanges(doc, "concept");
    // sorted by from
    let prev = -1;
    for (const c of changes) {
      expect(c.from).toBeGreaterThan(prev);
      prev = c.from;
    }
    let next = doc;
    // apply in reverse offset order (CM semantics) to verify result
    for (const c of [...changes].sort((a, b) => b.from - a.from)) {
      next = next.slice(0, c.from) + (c.insert ?? "") + next.slice(c.to);
    }
    expect(next).not.toContain("floatnote:tag=concept");
    expect(next).toContain("floatnote:tag=todo"); // other tag's markers untouched
    expect([...parseDefs(next).keys()]).toEqual(["todo"]);
  });
  it("removes the defs line entirely when the last tag is deleted", () => {
    const doc = `<!-- floatnote-tags: concept="概念"|c=#e5484d -->\nbody`;
    const changes = deleteTagChanges(doc, "concept");
    let next = doc;
    for (const c of [...changes].sort((a, b) => b.from - a.from)) {
      next = next.slice(0, c.from) + (c.insert ?? "") + next.slice(c.to);
    }
    expect(next).toBe("body");
  });
});

describe("slugify / uniqueSlug", () => {
  it("lowercases and kebab-cases", () => {
    expect(slugify("My Cool Tag")).toBe("my-cool-tag");
  });
  it("falls back to 'tag' for non-ascii names", () => {
    expect(slugify("概念")).toBe("tag");
  });
  it("uniqueSlug appends -2, -3 on collision", () => {
    expect(uniqueSlug("concept", ["concept"])).toBe("concept-2");
    expect(uniqueSlug("concept", ["concept", "concept-2"])).toBe("concept-3");
    expect(uniqueSlug("other", ["concept"])).toBe("other");
  });
});

/** Apply a single ChangeOp to a doc string (helper for assertions). */
function applyChange(doc: string, c: { from: number; to: number; insert: string } | null): string {
  if (!c) return doc;
  return doc.slice(0, c.from) + c.insert + doc.slice(c.to);
}
