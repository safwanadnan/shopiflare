import type { ActionFunctionArgs } from "react-router";
import { getDb } from "../db.server";
import { shopifyGdprRequests } from "../db/schema";
import { verifyShopifyWebhook } from "../services/shopify-webhook-auth.server";

const complianceTopics = ["customers/data_request", "customers/redact", "shop/redact"];

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const { topic, shop, payload } = await verifyShopifyWebhook(request, env, complianceTopics);
  const deliveryId = request.headers.get("x-shopify-event-id") || request.headers.get("x-shopify-webhook-id");
  if (!deliveryId || !/^[a-z0-9-]{1,128}$/i.test(deliveryId)) {
    return new Response("Missing or invalid webhook ID", { status: 400 });
  }

  // Keep the intake independent of the Shop row, which may already be gone.
  await getDb(env).insert(shopifyGdprRequests).values({
    id: [shop, topic, deliveryId].join(":"),
    shopDomain: shop,
    topic,
    payload: JSON.stringify(payload),
  }).onConflictDoNothing({ target: shopifyGdprRequests.id });

  return new Response(null, { status: 204 });
};
