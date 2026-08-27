import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { session, admin } = await shopify.authenticate.admin(request);
  const prisma = getPrisma(env);

  try {
    const shopResponse = await admin.graphql(
      `#graphql
        query {
          shop {
            id
            name
            email
            myshopifyDomain
            primaryDomain {
              host
              url
            }
            currencyCode
            plan {
              displayName
              partnerDevelopment
            }
            ianaTimezone
          }
        }`,
    );
    const shopJson = (await shopResponse.json()) as any;
    const shop = shopJson?.data?.shop;

    if (shop) {
      await prisma.shop.upsert({
        where: { shopifyDomain: session.shop },
        create: {
          shopifyDomain: session.shop,
          domain: shop.primaryDomain?.host || session.shop,
          name: shop.name,
          email: shop.email,
          currency: shop.currencyCode,
          planName: shop.plan?.displayName,
          planDisplayName: shop.plan?.displayName,
          ianaTimezone: shop.ianaTimezone,
          accessToken: session.accessToken,
          scope: session.scope,
        },
        update: {
          domain: shop.primaryDomain?.host || session.shop,
          name: shop.name,
          email: shop.email,
          currency: shop.currencyCode,
          planName: shop.plan?.displayName,
          planDisplayName: shop.plan?.displayName,
          ianaTimezone: shop.ianaTimezone,
          accessToken: session.accessToken,
          scope: session.scope,
          uninstalledAt: null,
        },
      });
    }
  } catch (error) {
    console.error("Error syncing shop data:", error);
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
