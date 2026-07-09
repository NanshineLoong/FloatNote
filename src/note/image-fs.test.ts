import { describe, it, expect } from "vitest";
import { imageSrc } from "./image-fs";

describe("imageSrc", () => {
  it("passes http(s) through", () => {
    expect(imageSrc("https://x.com/a.png", "/p")).toBe("https://x.com/a.png");
  });
  it("encodes a relative path to the floatnote-img protocol", () => {
    const url = imageSrc("./_assets/截图 1.png", "/Users/a/proj");
    expect(url.startsWith("floatnote-img://local/")).toBe(true);
    expect(decodeURIComponent(url.slice("floatnote-img://local/".length)))
      .toBe("/Users/a/proj/_assets/截图 1.png");
  });
  it("encodes an absolute path directly", () => {
    const url = imageSrc("/abs/_assets/x.png", "/p");
    expect(decodeURIComponent(url.slice("floatnote-img://local/".length)))
      .toBe("/abs/_assets/x.png");
  });
});
