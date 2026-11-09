import type { ActionFunctionArgs } from "react-router";
import { getDb } from "../db.server";
import { processAppSubscriptionWebhook } from "../services/subscription.server";
import { verifyShopifyWebhook } from "../services/shopify-webhook-auth.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const { shop, payload } = await verifyShopifyWebhook(request, env, ["app_subscriptions/update"]);
  const record = await processAppSubscriptionWebhook(payload, shop, getDb(env));
  return new Response(null, { status: record ? 204 : 500 });
};
