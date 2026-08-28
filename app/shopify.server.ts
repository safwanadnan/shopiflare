import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "./session-storage.server";
import { getPrisma } from "./db.server";

let cachedApp: ReturnType<typeof shopifyApp> | undefined;

export function getShopify(env: Env) {
  if (cachedApp) return cachedApp;

  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) {
    throw new Error(
      `[Shopiflare] Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET. Please configure these secrets on your Cloudflare Worker using:\n` +
      `  npx wrangler secret put SHOPIFY_API_KEY\n` +
      `  npx wrangler secret put SHOPIFY_API_SECRET`,
    );
  }

  const prisma = getPrisma(env);
  cachedApp = shopifyApp({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    apiVersion: ApiVersion.October25,
    scopes: env.SCOPES?.split(",") || ["write_products"],
    appUrl: env.SHOPIFY_APP_URL || "https://shopiflare.scrptble.workers.dev",
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(prisma),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });
  return cachedApp;
}

export const apiVersion = ApiVersion.October25;

export function addDocumentResponseHeaders(
  request: Request,
  headers: Headers,
) {
  if (cachedApp) {
    cachedApp.addDocumentResponseHeaders(request, headers);
  }
}
