import type { ActionFunctionArgs } from "react-router";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";
import { resolveShop } from "../services/shop.server";
import { logger } from "../services/logger.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { topic, shop, payload } = await shopify.authenticate.webhook(request);

  const prisma = getPrisma(env);
  const existingShop = await resolveShop(prisma, { shopDomain: shop });
  const shopLogger = logger.withContext({
    shopId: existingShop?.id ?? null,
    shopDomain: shop,
    topic,
  });

  try {
    const gdprRecord = await prisma.shopifyGdprRequest.create({
      data: {
        shopId: existingShop?.id ?? null,
        shopDomain: shop,
        topic,
        payload: (payload as object) ?? {},
      },
    });

    shopLogger.info(`Successfully recorded GDPR compliance request for topic ${topic} on ${shop}`, {
      gdprRequestId: gdprRecord.id,
    });
  } catch (err: any) {
    shopLogger.error(`Failed to record GDPR compliance request for topic ${topic} on ${shop}`, {
      error: err,
    });
  }

  return new Response();
};
