import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { verifyShopifyWebhook } from "../app/services/shopify-webhook-auth.server.ts";

const secret = "fixture-secret";
const body = '{ "shop_id": 123 }';
const signature = createHmac("sha256", secret).update(body).digest("base64");

function request(raw = body, headers = {}) {
  return new Request("https://worker.example/webhooks/compliance", {
    method: "POST",
    body: raw,
    headers: {
      "x-shopify-shop-domain": "fixture.myshopify.com",
      "x-shopify-topic": "shop/redact",
      "x-shopify-hmac-sha256": signature,
      ...headers,
    },
  });
}

const verify = input => verifyShopifyWebhook(input, { SHOPIFY_API_SECRET: secret }, ["shop/redact"]);

test("a signed compliance delivery needs no session or database binding", async () => {
  assert.deepEqual(await verify(request()), {
    shop: "fixture.myshopify.com",
    topic: "shop/redact",
    payload: { shop_id: 123 },
  });
  await assert.rejects(verify(request('{"shop_id":123}')), { status: 401 });
  await assert.rejects(verify(request(body, { "x-shopify-topic": "app/uninstalled" })), { status: 400 });
  await assert.rejects(verify(request(body, { "x-shopify-shop-domain": "other.example" })), { status: 400 });
});

test("an oversized stream is rejected without trusting Content-Length", async () => {
  await assert.rejects(verify(request("x".repeat(1024 * 1024 + 1))), { status: 413 });
});

test("the D1 migration blocks new non-expiring offline credentials and allows rotation", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
    const insert = db.prepare(`INSERT INTO Session (id, shop, state, isOnline, accessToken, expires)
      VALUES (?, 'fixture.myshopify.com', '', ?, ?, ?)`);
    insert.run("legacy", 0, "legacy", null);
    db.exec(readFileSync(new URL("../migrations/0002_offline_expiry_guard.sql", import.meta.url), "utf8"));
    assert.throws(() => insert.run("offline", 0, "legacy", null), /require an expiry/);
    assert.throws(() => insert.run("offline", 0, "legacy", "invalid-date"), /require an expiry/);
    insert.run("offline", 0, "new", "2099-01-01T00:00:00.000Z");
    assert.throws(() => db.exec("UPDATE Session SET expires = NULL WHERE id = 'offline'"), /require an expiry/);
    db.exec("UPDATE Session SET accessToken = '', expires = NULL WHERE id = 'offline'");
    insert.run("online", 1, "online", null);
    assert.equal(db.prepare("SELECT count(*) AS n FROM Session").get().n, 3);
  } finally {
    db.close();
  }
});
