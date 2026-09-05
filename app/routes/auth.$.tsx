import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";
import { enrichShopFromGraphql } from "../services/shop.server";
import { logger } from "../services/logger.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { session, admin } = await shopify.authenticate.admin(request);
  const prisma = getPrisma(env);

  try {
    await enrichShopFromGraphql(admin, session.shop, prisma, {
      accessToken: session.accessToken,
      scope: session.scope,
    });
  } catch (error: any) {
    logger.error(`Failed to sync shop data during OAuth authentication in auth.$ loader for ${session.shop}`, {
      shopDomain: session.shop,
      error,
    });
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
