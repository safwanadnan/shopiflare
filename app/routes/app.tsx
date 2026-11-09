import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { eq } from "drizzle-orm";
import { getShopify } from "../shopify.server";
import { getDb } from "../db.server";
import { shops } from "../db/schema";
import { enrichShopFromGraphql } from "../services/shop.server";
import { syncAppSubscriptionsFromGraphql } from "../services/subscription.server";
import { logger } from "../services/logger.server";
import { requestContext } from "../services/request-context.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const env = context.cloudflare.env;
  const shopify = getShopify(env);
  const { session, admin } = await shopify.authenticate.admin(request);
  const db = getDb(env);

  if (requestContext.getStore()?.afterAuthSyncScheduled) return { apiKey: env.SHOPIFY_API_KEY };

  // Background self-healing check: enrich shop data and sync subscriptions ONLY if not yet populated
  context.cloudflare.ctx.waitUntil(
    (async () => {
      try {
        const shop = await db.query.shops.findFirst({
          where: eq(shops.shopifyDomain, session.shop),
          columns: { rawShopData: true, uninstalledAt: true },
        });
        if (!shop || !shop.rawShopData || shop.uninstalledAt) {
          await enrichShopFromGraphql(admin, session.shop, db, {
            scope: session.scope,
          });
          await syncAppSubscriptionsFromGraphql(admin, session.shop, db);
        }
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
    <AppProvider apiKey={apiKey}>
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

export const headers: HeadersFunction = boundary.headers;
