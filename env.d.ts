/// <reference types="vite/client" />
/// <reference types="@react-router/node" />
/// <reference types="@cloudflare/workers-types" />

type Env = {
  SHOPIFY_SESSIONS: KVNamespace;
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  SHOPIFY_APP_URL?: string;
  SCOPES?: string;
  SHOP_CUSTOM_DOMAIN?: string;
};
