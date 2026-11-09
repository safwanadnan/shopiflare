import "@shopify/shopify-app-react-router/adapters/node";
import { abstractFetch, setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
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
import { coordinateShopifyOAuth, runWithShopifyAuth, shopifyAuthContext } from "./services/shopify-auth-state.server";

setAbstractFetchFunc(coordinateShopifyOAuth(abstractFetch));

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
    sessionStorage: new DrizzleSessionStorage(db, env),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    hooks: {
      afterAuth: async ({ session, admin }) => {
        const auth = shopifyAuthContext.getStore();
        if (!auth) throw new Error("Shopify after-auth hook requires coordinated authentication.");
        const request = requestContext.getStore();
        if (request?.afterAuthSyncScheduled) return;
        if (request) request.afterAuthSyncScheduled = true;
        // Start network/profile work after releasing the authorization lease.
        auth.afterAuth = async () => {
          const sync = (async () => {
            await enrichShopFromGraphql(admin, session.shop, db, { scope: session.scope });
            await syncAppSubscriptionsFromGraphql(admin, session.shop, db);
          })().catch(error => {
            logger.error("shopify.after_auth_sync_failed", { shopDomain: session.shop, error });
          });
          if (request) request.execution.waitUntil(sync);
          else await sync;
        };
      },
    },
    ...(env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });
  const coordinated = <Args extends unknown[], Result>(
    mode: "admin" | "background",
    authenticate: (...args: Args) => Promise<Result>,
  ) => (...args: Args) => runWithShopifyAuth(env, mode, () => authenticate(...args));

  app.authenticate.admin = coordinated("admin", app.authenticate.admin);
  // These SDK paths can also refresh an offline credential after verification.
  app.authenticate.flow = coordinated("background", app.authenticate.flow);
  app.authenticate.fulfillmentService = coordinated("background", app.authenticate.fulfillmentService);
  app.authenticate.public.appProxy = coordinated("background", app.authenticate.public.appProxy);
  app.authenticate.webhook = coordinated("background", app.authenticate.webhook);
  const { admin, storefront } = app.unauthenticated;
  app.unauthenticated.admin = coordinated("background", (shop: string) => admin(shop.toLowerCase()));
  app.unauthenticated.storefront = coordinated("background", (shop: string) => storefront(shop.toLowerCase()));
  apps.set(env, app);
  return app;
}

export function addDocumentResponseHeaders(request: Request, headers: Headers, env: Env) {
  getShopify(env).addDocumentResponseHeaders(request, headers);
}
