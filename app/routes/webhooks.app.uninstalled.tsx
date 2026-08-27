import type { ActionFunctionArgs } from "react-router";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { shop, session, topic } = await shopify.authenticate.webhook(request);
  const prisma = getPrisma(env);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (session) {
    await shopify.sessionStorage.deleteSessions([session.id]);
  }

  await prisma.shop
    .update({
      where: { shopifyDomain: shop },
      data: { uninstalledAt: new Date() },
    })
    .catch(() => {});

  return new Response();
};
