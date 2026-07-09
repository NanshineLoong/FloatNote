import { describe, it, expect } from "vitest";
import { parseImage, parseAttrBlock, writeAttrs, slugifyImageName } from "./image-attrs";

describe("parseImage", () => {
  it("parses caption url and attrs", () => {
    const a = parseImage("![图注](./_assets/arch.png){width=400 .center}")!;
    expect(a.caption).toBe("图注");
    expect(a.url).toBe("./_assets/arch.png");
    expect(a.width).toBe(400);
    expect(a.align).toBe("center");
  });

  it("works without attr block", () => {
    const a = parseImage("![alt](https://x.com/a.png)")!;
    expect(a.caption).toBe("alt");
    expect(a.url).toBe("https://x.com/a.png");
    expect(a.width).toBeNull();
    expect(a.align).toBeNull();
  });

  it("returns null for non-image", () => {
    expect(parseImage("[link](url)")).toBeNull();
  });
});

describe("parseAttrBlock", () => {
  it("parses width and class in order", () => {
    const r = parseAttrBlock("{width=400 .center}");
    expect(r).toEqual({ width: 400, align: "center" });
  });
  it("parses width only", () => {
    expect(parseAttrBlock("{width=250}")).toEqual({ width: 250, align: null });
  });
  it("parses align only", () => {
    expect(parseAttrBlock("{.right}")).toEqual({ width: null, align: "right" });
  });
  it("returns nulls on garbage", () => {
    expect(parseAttrBlock("{garbage}")).toEqual({ width: null, align: null });
  });
  it("returns nulls when no block", () => {
    expect(parseAttrBlock("")).toEqual({ width: null, align: null });
  });
});

describe("writeAttrs", () => {
  it("emits full canonical form", () => {
    expect(writeAttrs({ caption: "图注", url: "./_assets/a.png", width: 400, align: "center" }))
      .toBe("![图注](./_assets/a.png){width=400 .center}");
  });
  it("omits block when no width and no align", () => {
    expect(writeAttrs({ caption: "", url: "./_assets/a.png", width: null, align: null }))
      .toBe("![](./_assets/a.png)");
  });
  it("omits class when null", () => {
    expect(writeAttrs({ caption: "c", url: "u", width: 300, align: null }))
      .toBe("![c](u){width=300}");
  });
  it("omits width when null", () => {
    expect(writeAttrs({ caption: "c", url: "u", width: null, align: "left" }))
      .toBe("![c](u){.left}");
  });
});

describe("slugifyImageName", () => {
  it("replaces spaces and separators with dash, keeps unicode", () => {
    expect(slugifyImageName("截图 1")).toBe("截图-1");
    expect(slugifyImageName("a/b:c")).toBe("a-b-c");
  });
});
