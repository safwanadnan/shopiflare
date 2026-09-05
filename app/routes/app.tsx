import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { getShopify } from "../shopify.server";
import { getPrisma } from "../db.server";
import { enrichShopFromGraphql } from "../services/shop.server";
import { syncAppSubscriptionsFromGraphql } from "../services/subscription.server";
import { logger } from "../services/logger.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { session, admin } = await shopify.authenticate.admin(request);
  const prisma = getPrisma(env);

  // Background self-healing check: enrich shop data and sync subscriptions
  context.cloudflare.ctx.waitUntil(
    (async () => {
      try {
        const shop = await prisma.shop.findUnique({
          where: { shopifyDomain: session.shop },
          select: { rawShopData: true },
        });
        if (!shop || !shop.rawShopData) {
          await enrichShopFromGraphql(admin, session.shop, prisma, {
            accessToken: session.accessToken,
            scope: session.scope,
          });
        }
        await syncAppSubscriptionsFromGraphql(admin, session.shop, prisma);
      } catch (err: any) {
        logger.error(`Failed background shop enrichment and subscription sync in app.loader for ${session.shop}`, {
          shopDomain: session.shop,
          error: err,
        });
      }
    })()
  );

  return { apiKey: env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/additional">Additional page</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
