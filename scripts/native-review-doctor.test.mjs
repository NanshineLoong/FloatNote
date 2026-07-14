import assert from "node:assert/strict";
import test from "node:test";

import {
  createWebDriverSession,
  parseDoctorOptions,
  waitForWebDriverReady,
} from "./native-review-doctor.mjs";

test("parseDoctorOptions accepts explicit port and timeout", () => {
  assert.deepEqual(parseDoctorOptions(["--port", "4555", "--timeout", "12000"]), {
    port: 4555,
    timeoutMs: 12000,
  });
});

test("waitForWebDriverReady retries connection failures until ready", async () => {
  let attempts = 0;
  const result = await waitForWebDriverReady({
    port: 4445,
    timeoutMs: 1000,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("connection refused");
      return new Response(JSON.stringify({ value: { ready: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    sleepImpl: async () => {},
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result, { value: { ready: true } });
});

test("createWebDriverSession targets main and deletes the probe session", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === "POST") {
      return new Response(JSON.stringify({ value: { sessionId: "probe-1", capabilities: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ value: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const sessionId = await createWebDriverSession({ port: 4445, fetchImpl });

  assert.equal(sessionId, "probe-1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://127.0.0.1:4445/session");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    capabilities: {
      alwaysMatch: {
        browserName: "tauri",
        "tauri:options": { windowLabel: "main" },
      },
      firstMatch: [{}],
    },
  });
  assert.equal(calls[1].url, "http://127.0.0.1:4445/session/probe-1");
  assert.equal(calls[1].init.method, "DELETE");
});

test("createWebDriverSession reports the response body on protocol failure", async () => {
  await assert.rejects(
    () => createWebDriverSession({
      port: 4445,
      fetchImpl: async () => new Response("session crashed", { status: 500 }),
    }),
    /POST \/session failed \(500\): session crashed/,
  );
});
