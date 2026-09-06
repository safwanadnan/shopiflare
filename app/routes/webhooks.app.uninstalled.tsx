import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { getShopify } from "../shopify.server";
import { getDb } from "../db.server";
import { shops } from "../db/schema";
import { resolveShop } from "../services/shop.server";
import { logger } from "../services/logger.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { shop, session, topic } = await shopify.authenticate.webhook(request);
  const db = getDb(env);

  const shopRecord = await resolveShop(db, { shopDomain: shop });
  const shopLogger = logger.withContext({
    shopId: shopRecord?.id ?? null,
    shopDomain: shop,
    topic,
  });

  if (session) {
    await shopify.sessionStorage.deleteSessions([session.id]);
  }

  await db
    .update(shops)
    .set({ uninstalledAt: new Date(), updatedAt: new Date() })
    .where(eq(shops.shopifyDomain, shop))
    .catch(() => {});

  shopLogger.info(`Successfully processed app/uninstalled webhook for ${shop}, deleted active sessions and marked store uninstalled`, {
    sessionIdDeleted: session?.id || null,
  });

  return new Response();
};
