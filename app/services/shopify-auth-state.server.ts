import { AsyncLocalStorage } from "node:async_hooks";
import type { AbstractFetchFunc } from "@shopify/shopify-api/runtime";

const leaseMs = 60_000;
const oauthTimeoutMs = 15_000;
const dbNow = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

type AuthMode = "admin" | "background";
type AuthState = {
  generation: number;
  authorizedAt: number;
  uninstalledAt: string | null;
};

export type ShopifyAuthLease = AuthState & {
  shop: string;
  token: string;
  startedAt: number;
  expiresAt: number;
};

type AuthContext = {
  env: Env;
  mode: AuthMode;
  lease?: ShopifyAuthLease;
  grantReceived?: boolean;
  afterAuth?: () => Promise<void>;
};

export const shopifyAuthContext = new AsyncLocalStorage<AuthContext>();

export const leaseGeneration = "shop = ? AND generation = ? AND leaseToken = ?";
export const ownedLease = `${leaseGeneration} AND leaseExpiresAt > ${dbNow}`;

export function leaseBindings(lease: ShopifyAuthLease, generation = lease.generation) {
  return [lease.shop, generation, lease.token] as const;
}

export async function acquireShopifyAuthLease(env: Env, shop: string, waitMs: number): Promise<ShopifyAuthLease> {
  const token = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  while (true) {
    const state = await env.DB.prepare(`
      INSERT INTO ShopifyAuthState (shop, leaseToken, leaseExpiresAt)
      VALUES (?, ?, ${dbNow} + ?)
      ON CONFLICT (shop) DO UPDATE SET
        leaseToken = excluded.leaseToken, leaseExpiresAt = excluded.leaseExpiresAt
      WHERE ShopifyAuthState.leaseExpiresAt <= ${dbNow}
      RETURNING generation, authorizedAt, uninstalledAt, leaseExpiresAt AS expiresAt
    `).bind(shop, token, leaseMs).first<AuthState & { expiresAt: number }>();
    if (state) return { ...state, shop, token, startedAt: state.expiresAt - leaseMs };
    if (Date.now() >= deadline) {
      throw new Response("Shopify authorization is busy. Retry shortly.", {
        status: 503,
        headers: { "Retry-After": "1" },
      });
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

async function releaseShopifyAuthLease(env: Env, lease: ShopifyAuthLease) {
  try {
    await env.DB.prepare(`
      UPDATE ShopifyAuthState SET leaseToken = NULL, leaseExpiresAt = 0
      WHERE shop = ? AND leaseToken = ?
    `).bind(lease.shop, lease.token).run();
  } catch {
    // Expiry still frees the lease if D1 is temporarily unavailable.
    console.warn({ message: "shopify.auth_lease_release_failed" });
  }
}

export async function runWithShopifyAuth<T>(env: Env, mode: AuthMode, work: () => Promise<T>): Promise<T> {
  const context: AuthContext = { env, mode };
  let result: T;
  try {
    result = await shopifyAuthContext.run(context, work);
  } finally {
    if (context.lease) await releaseShopifyAuthLease(env, context.lease);
  }
  await context.afterAuth?.();
  return result;
}

/** Only the pinned SDK's credential exchange/refresh endpoint needs the lease. */
export function coordinateShopifyOAuth(transport: AbstractFetchFunc): AbstractFetchFunc {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname !== "/admin/oauth/access_token") return transport(input, init);
    const context = shopifyAuthContext.getStore();
    const lease = context?.lease;
    if (!lease || url.protocol !== "https:" || url.hostname !== lease.shop ||
      lease.expiresAt - Date.now() <= oauthTimeoutMs) {
      throw new Error("Shopify OAuth requires an active lease for this shop.");
    }

    context.grantReceived = false;
    const timeout = AbortSignal.timeout(oauthTimeoutMs);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const response = await transport(input, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
    });
    context.grantReceived = response.ok;
    return response;
  };
}

export async function uninstallShopifyCredentials(env: Env, shop: string, triggeredAt: string | null) {
  const eventAt = triggeredAt ? Date.parse(triggeredAt) : NaN;
  if ((triggeredAt && !Number.isFinite(eventAt)) || eventAt > Date.now() + 300_000) {
    throw new Response("Invalid Shopify uninstall timestamp.", { status: 400 });
  }

  // Shopify webhooks have a short response deadline. Let Shopify retry contention.
  const lease = await acquireShopifyAuthLease(env, shop, 500);
  try {
    if (lease.uninstalledAt) return;
    if (lease.authorizedAt && !Number.isFinite(eventAt)) {
      throw new Response("Shopify uninstall timestamp is required.", { status: 503 });
    }
    if (Number.isFinite(eventAt) && eventAt < lease.authorizedAt) return;

    const now = new Date().toISOString();
    const next = leaseBindings(lease, lease.generation + 1);
    // The first statement fences the change. Subsequent writes check the new
    // generation in the same atomic batch, even if the clock crosses expiry.
    const guard = `EXISTS (SELECT 1 FROM ShopifyAuthState WHERE ${leaseGeneration})`;
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE ShopifyAuthState SET generation = generation + 1, uninstalledAt = ?
        WHERE ${ownedLease}
      `).bind(now, ...leaseBindings(lease)),
      env.DB.prepare(`DELETE FROM Session WHERE shop = ? AND ${guard}`).bind(shop, ...next),
      env.DB.prepare(`
        UPDATE Shop SET accessToken = NULL, uninstalledAt = ?, updatedAt = ?
        WHERE shopifyDomain = ? AND ${guard}
      `).bind(now, now, shop, ...next),
    ]);
    if (results[0].meta.changes !== 1) {
      throw new Response("Shopify authorization changed during uninstall.", { status: 503 });
    }
  } finally {
    await releaseShopifyAuthLease(env, lease);
  }
}
