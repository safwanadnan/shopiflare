import { createRequestHandler } from "react-router";

declare global {
  interface CloudflareEnvironment extends Env {}
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    if (typeof process !== "undefined" && process.env) {
      Object.assign(process.env, env);
    }
    (globalThis as any).SHOPIFY_SESSIONS = env.SHOPIFY_SESSIONS;
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
