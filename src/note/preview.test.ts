import { describe, expect, it } from "vitest";
import { iconCacheStateKey, shouldRetryMissingIcon } from "./preview";

describe("quote icon retry", () => {
  it("retries a missing app icon after the retry window", () => {
    expect(shouldRetryMissingIcon(1_000, 10_000, 30_000)).toBe(false);
    expect(shouldRetryMissingIcon(1_000, 31_000, 30_000)).toBe(true);
  });

  it("retries when a null icon cache has no failure timestamp", () => {
    expect(shouldRetryMissingIcon(undefined, 10_000, 30_000)).toBe(true);
  });

  it("uses a different widget key for empty, missing, and ready icons", () => {
    expect(iconCacheStateKey(false, undefined, undefined)).toBe("empty");
    expect(iconCacheStateKey(true, null, 1_000)).toBe("missing:1000");
    expect(iconCacheStateKey(true, "data:image/png;base64,x", undefined)).toBe("ready");
  });
});
