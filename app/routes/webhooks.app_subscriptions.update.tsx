import type { ActionFunctionArgs } from "react-router";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";
import {
  processAppSubscriptionWebhook,
  syncAppSubscriptionsFromGraphql,
} from "../services/subscription.server";
import { resolveShop } from "../services/shop.server";
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

  // 1. Process and save the incoming webhook payload
  const record = await processAppSubscriptionWebhook(payload, shop, prisma);

  shopLogger.info(`Successfully processed app_subscriptions/update webhook for ${shop} (subscription: ${record?.shopifySubscriptionId || "none"})`, {
    subscriptionId: record?.shopifySubscriptionId || null,
    status: record?.status || null,
  });

  // 2. Refresh active subscriptions via GraphQL Admin if offline session exists
  try {
    const unauth = await shopify.unauthenticated.admin(shop);
    if (unauth?.admin) {
      context.cloudflare.ctx.waitUntil(
        syncAppSubscriptionsFromGraphql(unauth.admin, shop, prisma),
      );
    }
  } catch (err: any) {
    // If no session exists yet, payload processing above is sufficient
  }

  return new Response();
};
