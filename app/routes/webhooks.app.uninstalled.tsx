import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { getDb } from "../db.server";
import { sessions, shops } from "../db/schema";
import { verifyShopifyWebhook } from "../services/shopify-webhook-auth.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const { shop } = await verifyShopifyWebhook(request, env, ["app/uninstalled"]);
  const db = getDb(env);
  const now = new Date();

  // D1 batches commit atomically. A failed write must be retried by Shopify.
  await db.batch([
    db.delete(sessions).where(eq(sessions.shop, shop)),
    db.update(shops).set({ accessToken: null, uninstalledAt: now, updatedAt: now }).where(eq(shops.shopifyDomain, shop)),
  ]);
  return new Response(null, { status: 204 });
};
