import { describe, expect, it } from "vitest";
import { parseGfmTable } from "./table";

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
