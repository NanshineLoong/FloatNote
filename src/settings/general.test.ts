import { describe, expect, it, vi } from "vitest";
import { persistAutostart } from "./general";

describe("persistAutostart", () => {
  it("compensates the OS login item when config persistence fails", async () => {
    const enable = vi.fn().mockResolvedValue(undefined);
    const disable = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockRejectedValue(new Error("disk full"));

    await expect(persistAutostart(true, { isEnabled: async () => false, enable, disable, save }))
      .rejects.toThrow("disk full");

    expect(enable).toHaveBeenCalledOnce();
    expect(disable).toHaveBeenCalledOnce();
  });

  it("reports both persistence and compensation failures", async () => {
    await expect(persistAutostart(true, {
      isEnabled: async () => false,
      enable: async () => undefined,
      disable: async () => { throw new Error("rollback denied"); },
      save: async () => { throw new Error("disk full"); },
    })).rejects.toThrow("回滚开机启动状态失败");
  });
});
