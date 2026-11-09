import { createRequestHandler } from "react-router";
import { logger } from "../app/services/logger.server";
import { requestContext } from "../app/services/request-context.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

async function readiness(env: Env) {
  const configured = Boolean(
    env.SHOPIFY_API_KEY && !env.SHOPIFY_API_KEY.startsWith("<") &&
    env.SHOPIFY_API_SECRET && env.SHOPIFY_APP_URL && !env.SHOPIFY_APP_URL.includes("<"),
  );
  let databaseReady = false;
  try {
    const [expiryGuard] = await env.DB.batch<{ count: number }>([
      env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'trigger' AND name IN ('Session_offline_expiry_insert', 'Session_offline_expiry_update')"),
      env.DB.prepare("SELECT refreshTokenExpires FROM Session LIMIT 0"),
      env.DB.prepare("SELECT generation, authorizedAt, uninstalledAt, leaseToken, leaseExpiresAt FROM ShopifyAuthState LIMIT 0"),
      env.DB.prepare("SELECT id FROM Shop LIMIT 0"),
      env.DB.prepare("SELECT id FROM AppSubscription LIMIT 0"),
      env.DB.prepare("SELECT id FROM ShopifyGdprRequest LIMIT 0"),
    ]);
    databaseReady = expiryGuard.results[0]?.count === 2;
  } catch (error) {
    logger.error("readiness.database_failed", { error });
  }

  const ok = configured && databaseReady;
  return Response.json(
    { ok, configured, databaseReady, version: env.VERSION_METADATA?.id ?? null },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    const requestId = crypto.randomUUID();
    return requestContext.run({
      requestId,
      environment: env.ENVIRONMENT,
      version: env.VERSION_METADATA?.id,
      execution: ctx,
    }, async () => {
      if (request.method === "GET" && path === "/health/live") {
        return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
      }
      if (request.method === "GET" && path === "/health") return readiness(env);

      let response: Response;
      try {
        response = await requestHandler(request, { cloudflare: { env, ctx } });
      } catch (error) {
        logger.error("worker.request_failed", { error });
        response = new Response("Internal Server Error", { status: 500 });
      }
      // Includes React Router's .data requests and document redirects.
      if (/^\/app(?:\/|\.data$|$)/.test(path) || /^\/auth(?:\/|\.data$|$)/.test(path)) {
        response = new Response(response.body, response);
        response.headers.set("Cache-Control", "private, no-store");
      }
      return response;
    });
  },
} satisfies ExportedHandler<Env>;
