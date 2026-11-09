import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import "@shopify/shopify-app-react-router/adapters/node";
import { abstractFetch, setAbstractFetchFunc } from "@shopify/shopify-api/runtime";

// Run the real SDK and session adapter against the actual migration SQL.
// This binding implements the D1 methods used by those paths on local SQLite.
function sqliteBinding(db) {
  function prepare(query, args = []) {
    return {
      bind: (...values) => prepare(query, values),
      first: async () => db.prepare(query).get(...args) ?? null,
      all: async () => ({ success: true, results: db.prepare(query).all(...args) }),
      raw: async () => {
        const statement = db.prepare(query);
        statement.setReturnArrays(true);
        return statement.all(...args);
      },
      run: () => ({ success: true, meta: db.prepare(query).run(...args) }),
    };
  }
  return {
    prepare,
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map(statement => statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const secret = "fixture-client-secret";
const shop = "fixture.myshopify.com";
const appUrl = "https://app.example";
const clientId = "fixture-client-id";
const exchangeGrant = "urn:ietf:params:oauth:grant-type:token-exchange";

function adminRequest(domain, signingSecret = secret) {
  const now = Math.floor(Date.now() / 1000);
  const base64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = base64({ alg: "HS256", typ: "JWT" });
  const claims = base64({
    dest: `https://${domain}`, iss: `https://${domain}/admin`, aud: clientId,
    sub: "123", exp: now + 60, nbf: now, iat: now, jti: randomUUID(), sid: "fixture",
  });
  const signature = createHmac("sha256", signingSecret).update(`${header}.${claims}`).digest("base64url");
  return new Request(`${appUrl}/app?shop=untrusted-hint.myshopify.com`, {
    headers: {
      authorization: `Bearer ${header}.${claims}.${signature}`,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    },
  });
}

test("the SDK coordinates exchange, refresh and reinstall through the same shop lease", async () => {
  const db = new DatabaseSync(":memory:");
  const originalFetch = globalThis.fetch;
  const originalTransport = abstractFetch;
  const grants = [];
  const afterAuthLeases = [];
  const cacheDir = mkdtempSync(join(tmpdir(), "shopiflare-auth-test-"));
  const server = await createServer({ configFile: false, cacheDir, server: { middlewareMode: true, ws: false } });
  try {
    for (const file of globSync("migrations/*.sql").sort()) db.exec(readFileSync(file, "utf8"));
    const mockFetch = async (input, init) => {
      const url = new URL(input);
      if (url.pathname === "/admin/oauth/access_token") {
        const { grant_type, refresh_token } = JSON.parse(init.body);
        grants.push(grant_type);
        const sequence = grants.length;
        if (grant_type === "refresh_token") assert.equal(refresh_token, "refresh-1");
        if (url.hostname === "lost-lease.myshopify.com") {
          db.prepare("UPDATE ShopifyAuthState SET leaseExpiresAt = 0 WHERE shop = ?").run(url.hostname);
        }
        await delay(30);
        return Response.json({
          access_token: `access-${sequence}`, refresh_token: `refresh-${sequence}`,
          expires_in: 3600, refresh_token_expires_in: 86400, scope: "write_products",
        });
      }
      assert.match(url.pathname, /\/graphql\.json$/);
      const state = db.prepare("SELECT leaseToken FROM ShopifyAuthState WHERE shop = ?").get(url.hostname);
      afterAuthLeases.push(state.leaseToken);
      const { query } = JSON.parse(init.body);
      return Response.json({ data: query.includes("ShopEnrichment")
        ? { shop: { id: "gid://shopify/Shop/123", name: "Fixture", myshopifyDomain: shop, plan: {} } }
        : { currentAppInstallation: { activeSubscriptions: [] } } });
    };
    globalThis.fetch = mockFetch;
    setAbstractFetchFunc(mockFetch);

    const { getShopify } = await server.ssrLoadModule("/app/shopify.server.ts");
    const { action: uninstall } = await server.ssrLoadModule("/app/routes/webhooks.app.uninstalled.tsx");
    const env = {
      DB: sqliteBinding(db), SHOPIFY_APP_URL: appUrl, SHOPIFY_API_KEY: clientId,
      SHOPIFY_API_SECRET: secret, SCOPES: "write_products",
    };
    const sdk = getShopify(env);
    const state = domain => db.prepare("SELECT * FROM ShopifyAuthState WHERE shop = ?").get(domain);

    await assert.rejects(sdk.authenticate.admin(adminRequest("forged.myshopify.com", "wrong-secret")));
    assert.equal(state("forged.myshopify.com"), undefined);
    assert.equal(state("untrusted-hint.myshopify.com"), undefined);

    const installed = await Promise.all([
      sdk.authenticate.admin(adminRequest(shop)),
      sdk.authenticate.admin(adminRequest(shop)),
    ]);
    assert.deepEqual(installed.map(({ session }) => session.accessToken), ["access-1", "access-1"]);
    assert.deepEqual(grants, [exchangeGrant]);
    assert.deepEqual(afterAuthLeases, [null, null], "after-auth API work starts after releasing the lease");

    db.prepare("UPDATE Session SET expires = ? WHERE shop = ?")
      .run(new Date(Date.now() - 1000).toISOString(), shop);
    const refreshed = await Promise.all([sdk.unauthenticated.admin(shop), sdk.unauthenticated.admin(shop)]);
    assert.deepEqual(refreshed.map(({ session }) => session.accessToken), ["access-2", "access-2"]);
    assert.deepEqual(grants, [exchangeGrant, "refresh_token"]);

    const eventAt = new Date().toISOString();
    const uninstallRequest = (triggeredAt = eventAt) => {
      const body = '{"id":123}';
      return new Request(`${appUrl}/webhooks/app/uninstalled`, {
        method: "POST",
        body,
        headers: {
          "x-shopify-topic": "app/uninstalled",
          "x-shopify-shop-domain": shop,
          "x-shopify-triggered-at": triggeredAt,
          "x-shopify-hmac-sha256": createHmac("sha256", secret).update(body).digest("base64"),
        },
      });
    };
    const deliver = (triggeredAt) => uninstall({ request: uninstallRequest(triggeredAt), context: { cloudflare: { env } } });
    assert.equal((await deliver()).status, 204);
    await assert.rejects(sdk.unauthenticated.admin(shop));
    assert.ok(state(shop).uninstalledAt);
    assert.deepEqual(grants, [exchangeGrant, "refresh_token"], "background auth cannot reinstall a shop");

    await delay(5);
    assert.equal((await sdk.authenticate.admin(adminRequest(shop))).session.accessToken, "access-3");
    assert.equal(state(shop).uninstalledAt, null);
    await assert.rejects(deliver(""), { status: 503 });
    assert.equal((await deliver()).status, 204, "acknowledge a delayed uninstall without deleting the reinstall");
    assert.equal((await sdk.unauthenticated.admin(shop)).session.accessToken, "access-3");

    await assert.rejects(sdk.authenticate.admin(adminRequest("lost-lease.myshopify.com")), /changed before credentials/);
    assert.equal(db.prepare("SELECT id FROM Session WHERE shop = ?").get("lost-lease.myshopify.com"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
    setAbstractFetchFunc(originalTransport);
    await server.close();
    rmSync(cacheDir, { recursive: true, force: true });
    db.close();
  }
});
