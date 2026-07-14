// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountOutputMode } from "./output-mode";

describe("mountOutputMode", () => {
  it("saves a detailed selection", async () => {
    const root = document.createElement("div");
    const config = { assistant_output_mode: "compact" as const };
    const save = vi.fn().mockResolvedValue(undefined);
    mountOutputMode(root, config, save);
    const detailed = root.querySelector<HTMLInputElement>('input[value="detailed"]')!;
    detailed.checked = true;
    detailed.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith("detailed"));
    expect(config.assistant_output_mode).toBe("detailed");
  });

  it("restores compact when persistence fails", async () => {
    const root = document.createElement("div");
    const config: { assistant_output_mode: "compact" | "detailed" } = { assistant_output_mode: "compact" };
    mountOutputMode(root, config, vi.fn().mockRejectedValue(new Error("disk full")));
    const detailed = root.querySelector<HTMLInputElement>('input[value="detailed"]')!;
    detailed.checked = true;
    detailed.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input[value="compact"]')!.checked).toBe(true));
    expect(config.assistant_output_mode).toBe("compact");
    expect(root.textContent).toContain("disk full");
  });
});
