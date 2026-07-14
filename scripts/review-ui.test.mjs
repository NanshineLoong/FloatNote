import assert from "node:assert/strict";
import test from "node:test";

import { waitForReviewUrl, withLoopbackNoProxy } from "./review-ui.mjs";

test("withLoopbackNoProxy preserves existing exclusions and covers both variable names", () => {
  const env = withLoopbackNoProxy({ NO_PROXY: "example.test" });
  assert.equal(env.NO_PROXY, "example.test,127.0.0.1,localhost");
  assert.equal(env.no_proxy, env.NO_PROXY);
});

test("waitForReviewUrl retries until the fixture is reachable", async () => {
  let attempts = 0;
  await waitForReviewUrl({
    timeoutMs: 1_000,
    fetchImpl: async () => {
      attempts += 1;
      return new Response("", { status: attempts === 1 ? 503 : 200 });
    },
    sleepImpl: async () => {},
  });
  assert.equal(attempts, 2);
});
