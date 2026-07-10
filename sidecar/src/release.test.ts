import { describe, expect, it } from "vitest";
import { bundleOutputPath, tauriResourceBundlePath, targetBinaryPath, targetRuntimePath } from "./release.js";

describe("release artifact paths", () => {
  it("creates one portable ESM bundle path", () => {
    expect(bundleOutputPath("/repo/sidecar")).toBe("/repo/sidecar/dist/floatnote-agent.mjs");
  });

  it("uses Tauri's target-triple naming convention for the packaged sidecar", () => {
    expect(targetBinaryPath("/repo", "aarch64-apple-darwin", "darwin")).toBe(
      "/repo/src-tauri/binaries/floatnote-agent-aarch64-apple-darwin",
    );
    expect(targetBinaryPath("C:/repo", "x86_64-pc-windows-msvc", "win32")).toBe(
      "C:/repo/src-tauri/binaries/floatnote-agent-x86_64-pc-windows-msvc.exe",
    );
  });

  it("stages the bundle as a resource and the Node runtime as an external binary", () => {
    expect(tauriResourceBundlePath("/repo")).toBe("/repo/src-tauri/resources/sidecar/floatnote-agent.mjs");
    expect(targetRuntimePath("/repo", "aarch64-apple-darwin", "darwin")).toBe(
      "/repo/src-tauri/binaries/floatnote-node-aarch64-apple-darwin",
    );
  });
});
