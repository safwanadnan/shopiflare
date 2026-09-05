import type { ActionFunctionArgs } from "react-router";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";
import {
  enrichShopFromWebhookPayload,
  enrichShopFromGraphql,
  resolveShop,
} from "../services/shop.server";
import { logger } from "../services/logger.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { shop, payload, topic } = await shopify.authenticate.webhook(request);
  const prisma = getPrisma(env);

  const shopRecord = await resolveShop(prisma, { shopDomain: shop });
  const shopLogger = logger.withContext({
    shopId: shopRecord?.id ?? null,
    shopDomain: shop,
    topic,
  });

  // Immediate enrichment from webhook payload
  const updatedRecord = await enrichShopFromWebhookPayload(payload, shop, prisma);

  shopLogger.info(`Successfully processed shop/update webhook for ${shop}`, {
    shopId: updatedRecord?.id || shopRecord?.id || null,
    plan: updatedRecord?.planDisplayName || null,
  });

  // Background enrichment from full GraphQL Admin if offline session is present
  try {
    const unauth = await shopify.unauthenticated.admin(shop);
    if (unauth?.admin) {
      context.cloudflare.ctx.waitUntil(
        enrichShopFromGraphql(unauth.admin, shop, prisma),
      );
    }
  } catch (err: any) {
    // If no session exists yet, the webhook payload enrichment above is sufficient
  }

  return new Response();
};
