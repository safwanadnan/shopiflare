import type { ActionFunctionArgs } from "react-router";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";
import { resolveShop } from "../services/shop.server";
import { logger } from "../services/logger.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { shop, session, topic } = await shopify.authenticate.webhook(request);
  const prisma = getPrisma(env);

  const shopRecord = await resolveShop(prisma, { shopDomain: shop });
  const shopLogger = logger.withContext({
    shopId: shopRecord?.id ?? null,
    shopDomain: shop,
    topic,
  });

  if (session) {
    await shopify.sessionStorage.deleteSessions([session.id]);
  }

  await prisma.shop
    .update({
      where: { shopifyDomain: shop },
      data: { uninstalledAt: new Date() },
    })
    .catch(() => {});

  shopLogger.info(`Successfully processed app/uninstalled webhook for ${shop}, deleted active sessions and marked store uninstalled`, {
    sessionIdDeleted: session?.id || null,
  });

  return new Response();
};
