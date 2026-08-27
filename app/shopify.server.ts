import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { KVSessionStorage } from "@shopify/shopify-app-session-storage-kv";

// Proxy to access Cloudflare KV binding dynamically
const kvProxy = new Proxy({} as KVNamespace, {
  get(_target, prop: string | symbol) {
    const kv = (globalThis as any).SHOPIFY_SESSIONS;
    if (!kv) {
      return () => undefined;
    }
    const val = (kv as any)[prop];
    return typeof val === "function" ? val.bind(kv) : val;
  },
});

let _shopify: ReturnType<typeof shopifyApp> | null = null;

export function getShopify() {
  if (!_shopify) {
    const appUrl =
      process.env.SHOPIFY_APP_URL || "https://cloudflaretest.scrptble.workers.dev";

    _shopify = shopifyApp({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
      apiVersion: ApiVersion.October25,
      scopes: process.env.SCOPES?.split(",") || ["write_products"],
      appUrl,
      authPathPrefix: "/auth",
      sessionStorage: new KVSessionStorage(kvProxy),
      distribution: AppDistribution.AppStore,
      future: {
        expiringOfflineAccessTokens: true,
      },
      ...(process.env.SHOP_CUSTOM_DOMAIN
        ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
        : {}),
    });
  }
  return _shopify;
}

const shopify = new Proxy({} as ReturnType<typeof shopifyApp>, {
  get(_target, prop: string | symbol) {
    const instance = getShopify() as any;
    const val = instance[prop];
    return typeof val === "function" ? val.bind(instance) : val;
  },
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = (
  ...args: Parameters<ReturnType<typeof shopifyApp>["addDocumentResponseHeaders"]>
) => getShopify().addDocumentResponseHeaders(...args);

export const authenticate = new Proxy(
  {} as ReturnType<typeof shopifyApp>["authenticate"],
  {
    get(_target, prop: string | symbol) {
      const auth = getShopify().authenticate as any;
      const val = auth[prop];
      return typeof val === "function" ? val.bind(auth) : val;
    },
  },
);

export const unauthenticated = new Proxy(
  {} as ReturnType<typeof shopifyApp>["unauthenticated"],
  {
    get(_target, prop: string | symbol) {
      const unauth = getShopify().unauthenticated as any;
      const val = unauth[prop];
      return typeof val === "function" ? val.bind(unauth) : val;
    },
  },
);

export const login = (...args: Parameters<ReturnType<typeof shopifyApp>["login"]>) =>
  getShopify().login(...args);

export const registerWebhooks = (
  ...args: Parameters<ReturnType<typeof shopifyApp>["registerWebhooks"]>
) => getShopify().registerWebhooks(...args);

export const sessionStorage = new Proxy(
  {} as ReturnType<typeof shopifyApp>["sessionStorage"],
  {
    get(_target, prop: string | symbol) {
      const storage = getShopify().sessionStorage as any;
      const val = storage[prop];
      return typeof val === "function" ? val.bind(storage) : val;
    },
  },
);
