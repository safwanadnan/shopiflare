/// <reference types="vite/client" />
/// <reference types="@react-router/node" />
/// <reference types="@cloudflare/workers-types" />

import "react-router";

declare global {
  interface Env {
    DB: D1Database;
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    SCOPES: string;
    SHOPIFY_APP_URL: string;
    SHOP_CUSTOM_DOMAIN?: string;
  }
}

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}
