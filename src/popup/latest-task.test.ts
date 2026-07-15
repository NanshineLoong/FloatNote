import { describe, expect, it } from "vitest";
import { createLatestTaskQueue } from "./latest-task";

describe("latest task queue", () => {
  it("serializes work and marks an older awaited task stale when newer work arrives", async () => {
    const queue = createLatestTaskQueue();
    const events: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.schedule(async (isCurrent) => {
      events.push("first-start");
      await blocked;
      events.push(isCurrent() ? "first-current" : "first-stale");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = queue.schedule(async () => { events.push("second"); });
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-stale", "second"]);
  });
});
