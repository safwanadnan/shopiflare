import type { ActionFunctionArgs } from "react-router";
import { getShopify } from "../shopify.server";
import { getDb } from "../db.server";
import { shopifyGdprRequests } from "../db/schema";
import { resolveShop } from "../services/shop.server";
import { logger } from "../services/logger.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { topic, shop, payload } = await shopify.authenticate.webhook(request);

  const db = getDb(env);
  const existingShop = await resolveShop(db, { shopDomain: shop });
  const shopLogger = logger.withContext({
    shopId: existingShop?.id ?? null,
    shopDomain: shop,
    topic,
  });

  try {
    const id = crypto.randomUUID();
    await db.insert(shopifyGdprRequests).values({
      id,
      shopId: existingShop?.id ?? null,
      shopDomain: shop,
      topic,
      payload: payload ? JSON.stringify(payload) : null,
    });

    shopLogger.info(`Successfully recorded GDPR compliance request for topic ${topic} on ${shop}`, {
      gdprRequestId: id,
    });
  } catch (err: any) {
    shopLogger.error(`Failed to record GDPR compliance request for topic ${topic} on ${shop}`, {
      error: err,
    });
  }

  return new Response();
};
