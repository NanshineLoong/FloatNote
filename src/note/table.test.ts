import { describe, expect, it } from "vitest";
import { parseGfmTable, parseGfmTableOffsets } from "./table";

describe("parseGfmTable", () => {
  it("parses a basic 2-col table with no alignment", () => {
    const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const t = parseGfmTable(src);
    expect(t).not.toBeNull();
    expect(t!.header).toEqual(["a", "b"]);
    expect(t!.rows).toEqual([["1", "2"]]);
    expect(t!.aligns).toEqual(["none", "none"]);
  });

  it("parses left / right / center alignment from the delimiter row", () => {
    const src = "| a | b | c |\n| :--- | ---: | :---: |\n| 1 | 2 | 3 |";
    const t = parseGfmTable(src);
    expect(t!.aligns).toEqual(["left", "right", "center"]);
  });

  it("returns null when the second row is not a delimiter", () => {
    const src = "| a | b |\n| 1 | 2 |";
    expect(parseGfmTable(src)).toBeNull();
  });

  it("handles rows without leading/trailing pipes", () => {
    const src = "a | b\n--- | ---\n1 | 2";
    const t = parseGfmTable(src);
    expect(t!.header).toEqual(["a", "b"]);
    expect(t!.rows).toEqual([["1", "2"]]);
  });

  it("handles empty cells and extra trailing pipe", () => {
    const src = "| a | b |\n| --- | --- |\n|  |  |";
    const t = parseGfmTable(src);
    expect(t!.rows).toEqual([["", ""]]);
  });

  it("ignores leading/trailing blank lines", () => {
    const src = "\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const t = parseGfmTable(src);
    expect(t!.header).toEqual(["a", "b"]);
  });
});

describe("parseGfmTableOffsets", () => {
  /** Slice [from,to] out of src — should equal the cell's trimmed text. */
  const slice = (src: string, c: { from: number; to: number }) => src.slice(c.from, c.to);

  it("gives each cell a span that slices back to its trimmed text", () => {
    const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const t = parseGfmTableOffsets(src)!;
    expect(t.header.map((c) => slice(src, c))).toEqual(["a", "b"]);
    expect(t.rows[0].map((c) => slice(src, c))).toEqual(["1", "2"]);
    expect(t.aligns).toEqual(["none", "none"]);
    // Delimiter row span slices back to the whole delimiter line.
    expect(slice(src, t.delimiter)).toBe("| --- | --- |");
  });

  it("parses alignment from the delimiter row", () => {
    const src = "| a | b | c |\n| :--- | ---: | :---: |";
    expect(parseGfmTableOffsets(src)!.aligns).toEqual(["left", "right", "center"]);
  });

  it("returns null when the second row is not a delimiter", () => {
    expect(parseGfmTableOffsets("| a | b |\n| 1 | 2 |")).toBeNull();
  });

  it("handles rows without leading/trailing pipes", () => {
    const src = "a | b\n--- | ---\n1 | 2";
    const t = parseGfmTableOffsets(src)!;
    expect(t.header.map((c) => slice(src, c))).toEqual(["a", "b"]);
    expect(t.rows[0].map((c) => slice(src, c))).toEqual(["1", "2"]);
  });

  it("handles empty cells (zero-length span) and extra whitespace", () => {
    const src = "| a | b |\n| --- | --- |\n|   |   |";
    const t = parseGfmTableOffsets(src)!;
    const row = t.rows[0];
    expect(row.map((c) => c.text)).toEqual(["", ""]);
    expect(row.map((c) => slice(src, c))).toEqual(["", ""]);
    // Empty cell: from === to (a caret insertion point inside the cell).
    expect(row[0].from).toBe(row[0].to);
  });

  it("editing a cell = replacing exactly its span keeps the rest intact", () => {
    const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const t = parseGfmTableOffsets(src)!;
    const cell = t.rows[0][0]; // "1"
    const edited = src.slice(0, cell.from) + "10" + src.slice(cell.to);
    // The other cells of the same row ("2") must still slice cleanly from the
    // edited source (its span is after the edited cell, so offsets shifted).
    const t2 = parseGfmTableOffsets(edited)!;
    expect(edited.slice(t2.rows[0][0].from, t2.rows[0][0].to)).toBe("10");
    expect(edited.slice(t2.rows[0][1].from, t2.rows[0][1].to)).toBe("2");
  });
});
