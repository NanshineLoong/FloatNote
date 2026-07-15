import { describe, expect, it } from "vitest";
import { createConfigurationGate } from "./configuration-gate.js";

describe("createConfigurationGate", () => {
  it("holds session work that arrives before the initial configuration decision", async () => {
    const gate = createConfigurationGate();
    const handled: string[] = [];

    const openSession = gate.wait().then(() => handled.push("open_session"));
    await Promise.resolve();
    expect(handled).toEqual([]);

    await gate.initialize(() => handled.push("initialized"));
    await openSession;
    expect(handled).toEqual(["initialized", "open_session"]);
  });

  it("waits for configure before opening the restored session", async () => {
    let finishConfigure!: () => void;
    const configured = new Promise<void>((resolve) => {
      finishConfigure = resolve;
    });
    const gate = createConfigurationGate();
    const handled: string[] = [];

    const configure = gate.run(async () => {
      handled.push("configure");
      await configured;
    });
    const openSession = gate.wait().then(() => {
      handled.push("open_session");
    });

    await Promise.resolve();
    expect(handled).toEqual(["configure"]);

    finishConfigure();
    await Promise.all([configure, openSession]);
    expect(handled).toEqual(["configure", "open_session"]);
  });

  it("lets a later command proceed when configuration fails", async () => {
    const gate = createConfigurationGate();
    const configure = gate.run(() => Promise.reject(new Error("invalid key")));

    await expect(configure).rejects.toThrow("invalid key");
    await expect(gate.wait()).resolves.toBeUndefined();
  });
});
