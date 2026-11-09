import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { getDb } from "../db.server";
import { sessions } from "../db/schema";
import { verifyShopifyWebhook } from "../services/shopify-webhook-auth.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const { payload, shop } = await verifyShopifyWebhook(request, env, ["app/scopes_update"]);
  const current = payload.current;
  if (!Array.isArray(current) || !current.every(scope => typeof scope === "string")) {
    return new Response("Invalid scopes", { status: 400 });
  }
  // Update only scope; a concurrent token refresh must retain its new credentials.
  await getDb(env).update(sessions).set({ scope: current.join(",") }).where(eq(sessions.shop, shop));
  return new Response(null, { status: 204 });
};
