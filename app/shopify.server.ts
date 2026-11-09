import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { DrizzleSessionStorage } from "./session-storage.server";
import { getDb } from "./db.server";
import { enrichShopFromGraphql } from "./services/shop.server";
import { syncAppSubscriptionsFromGraphql } from "./services/subscription.server";
import { logger } from "./services/logger.server";
import { requestContext } from "./services/request-context.server";

const apps = new WeakMap<Env, ReturnType<typeof shopifyApp>>();
export const apiVersion = ApiVersion.October26;

export function getShopify(env: Env) {
  const cached = apps.get(env);
  if (cached) return cached;

  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET || !env.SHOPIFY_APP_URL) {
    throw new Error("Configure SHOPIFY_API_KEY, SHOPIFY_API_SECRET and SHOPIFY_APP_URL for this Worker.");
  }

  const db = getDb(env);
  const app = shopifyApp({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    apiVersion,
    scopes: env.SCOPES.split(",").map(scope => scope.trim()).filter(Boolean),
    appUrl: env.SHOPIFY_APP_URL,
    authPathPrefix: "/auth",
    sessionStorage: new DrizzleSessionStorage(db),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    hooks: {
      afterAuth: async ({ session, admin }) => {
        const context = requestContext.getStore();
        if (context?.afterAuthSyncScheduled) return;
        if (context) context.afterAuthSyncScheduled = true;
        const sync = (async () => {
          await enrichShopFromGraphql(admin, session.shop, db, { scope: session.scope });
          await syncAppSubscriptionsFromGraphql(admin, session.shop, db);
        })().catch(error => {
          logger.error("shopify.after_auth_sync_failed", { shopDomain: session.shop, error });
        });
        if (context) context.execution.waitUntil(sync);
        else await sync;
      },
    },
    ...(env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });
  apps.set(env, app);
  return app;
}

export function addDocumentResponseHeaders(request: Request, headers: Headers, env: Env) {
  getShopify(env).addDocumentResponseHeaders(request, headers);
}
