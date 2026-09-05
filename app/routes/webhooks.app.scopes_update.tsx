import type { ActionFunctionArgs } from "react-router";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";
import { resolveShop } from "../services/shop.server";
import { logger } from "../services/logger.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { payload, session, topic, shop } = await shopify.authenticate.webhook(request);
  const prisma = getPrisma(env);

  const shopRecord = await resolveShop(prisma, { shopDomain: shop });
  const shopLogger = logger.withContext({
    shopId: shopRecord?.id ?? null,
    shopDomain: shop,
    topic,
  });

  const current = payload.current as string[];
  if (session) {
    session.scope = current.toString();
    await shopify.sessionStorage.storeSession(session);
  }

  shopLogger.info(`Successfully processed app/scopes_update webhook for ${shop}`, {
    scopes: current,
  });

  return new Response();
};
