import type { ActionFunctionArgs } from "react-router";
import { getDb } from "../db.server";
import { enrichShopFromWebhookPayload } from "../services/shop.server";
import { verifyShopifyWebhook } from "../services/shopify-webhook-auth.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const { payload, shop } = await verifyShopifyWebhook(request, env, ["shop/update"]);
  const record = await enrichShopFromWebhookPayload(payload, shop, getDb(env));
  return new Response(null, { status: record ? 204 : 500 });
};
