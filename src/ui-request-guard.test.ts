import assert from "node:assert/strict";
import test from "node:test";

import { createUiRequestGuard, parseAllowedUiHosts } from "./ui-request-guard.js";

const guard = createUiRequestGuard({ host: "127.0.0.1", port: 3042 });

function post(headers: Record<string, string>) {
  return guard.check({ method: "POST", headers: { host: "127.0.0.1:3042", ...headers } });
}

test("the web ui accepts its own json requests", () => {
  assert.deepEqual(
    post({ origin: "http://127.0.0.1:3042", "content-type": "application/json" }),
    { ok: true },
  );
  assert.deepEqual(
    guard.check({
      method: "POST",
      headers: {
        host: "localhost:3042",
        origin: "http://localhost:3042",
        "content-type": "application/json; charset=utf-8",
        "sec-fetch-site": "same-origin",
      },
    }),
    { ok: true },
  );
  assert.deepEqual(guard.check({ method: "GET", headers: { host: "127.0.0.1:3042" } }), {
    ok: true,
  });
});

test("another site cannot reset the individual or speak for the user", () => {
  // 別のサイトから fetch(..., { mode: "no-cors", body: "{}" }) で送られた要求
  assert.deepEqual(post({ origin: "https://evil.example", "content-type": "text/plain" }), {
    ok: false,
    status: 403,
    error: "ui_origin_not_allowed",
  });
  assert.deepEqual(post({ "sec-fetch-site": "cross-site", "content-type": "application/json" }), {
    ok: false,
    status: 403,
    error: "ui_cross_site_request",
  });
  assert.deepEqual(post({ origin: "null", "content-type": "application/json" }), {
    ok: false,
    status: 403,
    error: "ui_origin_not_allowed",
  });
});

test("posts that a plain html form could send are refused", () => {
  for (const contentType of [
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
  ]) {
    assert.deepEqual(post({ "content-type": contentType }), {
      ok: false,
      status: 415,
      error: "ui_json_required",
    });
  }
  assert.deepEqual(post({}), { ok: false, status: 415, error: "ui_json_required" });
});

test("a rebinding hostname cannot reach a loopback ui", () => {
  assert.deepEqual(
    guard.check({ method: "GET", headers: { host: "attacker.example:3042" } }),
    { ok: false, status: 403, error: "ui_host_not_allowed" },
  );
  assert.deepEqual(guard.check({ method: "GET", headers: {} }), {
    ok: false,
    status: 403,
    error: "ui_host_not_allowed",
  });
});

test("an explicitly exposed ui accepts the configured host names", () => {
  const exposed = createUiRequestGuard({
    host: "0.0.0.0",
    port: 3042,
    allowedHosts: parseAllowedUiHosts("mac-mini.local, 192.168.1.20:3042"),
  });

  assert.deepEqual(
    exposed.check({
      method: "POST",
      headers: {
        host: "mac-mini.local:3042",
        origin: "http://mac-mini.local:3042",
        "content-type": "application/json",
      },
    }),
    { ok: true },
  );
  assert.deepEqual(exposed.check({ method: "GET", headers: { host: "192.168.1.20:3042" } }), {
    ok: true,
  });
  assert.deepEqual(exposed.check({ method: "GET", headers: { host: "other.local:3042" } }), {
    ok: false,
    status: 403,
    error: "ui_host_not_allowed",
  });
});
