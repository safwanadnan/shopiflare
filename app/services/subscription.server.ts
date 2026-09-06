import { eq } from "drizzle-orm";
import type { AppDb } from "../db.server";
import { appSubscriptions, type AppSubscriptionRecord, type InsertAppSubscriptionRecord } from "../db/schema";
import { resolveShop } from "./shop.server";
import { logger } from "./logger.server";

export const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query AppSubscriptions {
    appInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        createdAt
        currentPeriodEnd
        trialDays
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
                interval
              }
              ... on AppUsagePricing {
                cappedAmount {
                  amount
                  currencyCode
                }
                terms
              }
            }
          }
        }
      }
    }
  }
`;

export const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $test: Boolean
    $trialDays: Int
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
    ) {
      userErrors {
        field
        message
      }
      confirmationUrl
      appSubscription {
        id
        name
        status
      }
    }
  }
`;

export interface CreateSubscriptionPlanOptions {
  name: string;
  price: number;
  returnUrl: string;
  currencyCode?: string;
  interval?: "EVERY_30_DAYS" | "ANNUAL";
  trialDays?: number;
  test?: boolean;
}

export async function createAppSubscription(
  admin: { graphql: (query: string, options?: any) => Promise<any> },
  options: CreateSubscriptionPlanOptions,
): Promise<{ confirmationUrl: string | null; userErrors: any[] }> {
  const {
    name,
    price,
    returnUrl,
    currencyCode = "USD",
    interval = "EVERY_30_DAYS",
    trialDays = 0,
    test = false,
  } = options;

  const response = await admin.graphql(APP_SUBSCRIPTION_CREATE_MUTATION, {
    variables: {
      name,
      returnUrl,
      test,
      trialDays,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: price,
                currencyCode,
              },
              interval,
            },
          },
        },
      ],
    },
  });

  const json = await response.json();
  const data = json?.data?.appSubscriptionCreate;

  return {
    confirmationUrl: data?.confirmationUrl || null,
    userErrors: data?.userErrors || [],
  };
}

export async function syncAppSubscriptionsFromGraphql(
  admin: { graphql: (query: string, options?: any) => Promise<any> },
  shopDomain: string,
  db: AppDb,
): Promise<AppSubscriptionRecord[]> {
  const shopRecord = await resolveShop(db, { shopDomain });
  if (!shopRecord) {
    logger.warn(`Cannot sync app subscriptions: Shop ${shopDomain} does not exist in the database`, {
      shopDomain,
    });
    return [];
  }

  const shopLogger = logger.withContext({ shopId: shopRecord.id, shopDomain });

  try {
    const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
    const json = await response.json();

    if (json.errors && json.errors.length > 0) {
      shopLogger.error("GraphQL errors while executing AppSubscriptions query", {
        errors: json.errors,
      });
      return [];
    }

    const rawSubs: any[] =
      json?.data?.appInstallation?.activeSubscriptions || [];

    const syncedSubscriptions: AppSubscriptionRecord[] = [];

    for (const sub of rawSubs) {
      const numericId = String(sub.id).replace(/\D/g, "");
      const lineItem = sub.lineItems?.[0];
      const pricing = lineItem?.plan?.pricingDetails;

      const isRecurring = pricing?.__typename === "AppRecurringPricing";
      const isUsage = pricing?.__typename === "AppUsagePricing";

      const price = isRecurring ? parseFloat(pricing?.price?.amount) : null;
      const currency = isRecurring ? pricing?.price?.currencyCode : null;
      const interval = isRecurring ? pricing?.interval : null;
      const cappedAmount = isUsage ? parseFloat(pricing?.cappedAmount?.amount) : null;
      const terms = isUsage ? pricing?.terms : null;

      const subData: InsertAppSubscriptionRecord = {
        id: numericId,
        shopifySubscriptionId: sub.id,
        name: sub.name || null,
        status: sub.status || null,
        adminGraphqlApiId: sub.id,
        test: Boolean(sub.test),
        trialDays: sub.trialDays != null ? Number(sub.trialDays) : null,
        currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
        price,
        currency,
        interval,
        cappedAmount,
        terms,
        lineItems: sub.lineItems ? JSON.stringify(sub.lineItems) : null,
        rawPayload: JSON.stringify(sub),
        shopId: shopRecord.id,
        shopifyCreatedAt: sub.createdAt ? new Date(sub.createdAt) : null,
        updatedAt: new Date(),
      };

      const updateSet = { ...subData };
      delete (updateSet as any).id;

      await db
        .insert(appSubscriptions)
        .values(subData)
        .onConflictDoUpdate({
          target: appSubscriptions.shopifySubscriptionId,
          set: updateSet,
        });

      const savedSub = await db.query.appSubscriptions.findFirst({
        where: eq(appSubscriptions.shopifySubscriptionId, sub.id),
      });

      if (savedSub) syncedSubscriptions.push(savedSub);
    }

    shopLogger.info(
      `Successfully synced ${syncedSubscriptions.length} active app subscription(s) from Shopify GraphQL for ${shopDomain}`,
      { shopDomain, activeCount: syncedSubscriptions.length },
    );

    return syncedSubscriptions;
  } catch (error: any) {
    shopLogger.error(`Exception occurred during app subscription sync for ${shopDomain}`, {
      error,
    });
    return [];
  }
}

export async function processAppSubscriptionWebhook(
  payload: any,
  shopDomain: string,
  db: AppDb,
): Promise<AppSubscriptionRecord | null> {
  const shopRecord = await resolveShop(db, { shopDomain });
  if (!shopRecord) {
    logger.warn(`Received app_subscriptions/update webhook but shop ${shopDomain} is not found in database`, {
      shopDomain,
    });
    return null;
  }

  const shopLogger = logger.withContext({ shopId: shopRecord.id, shopDomain });

  try {
    const rawSub = payload?.app_subscription;
    if (!rawSub || !rawSub.admin_graphql_api_id) {
      shopLogger.warn("Subscription webhook payload missing admin_graphql_api_id", { payload });
      return null;
    }

    const numericId = String(rawSub.admin_graphql_api_id).replace(/\D/g, "");
    const lineItem = rawSub.line_items?.[0];
    const plan = lineItem?.plan;
    const pricing = plan?.pricing_details;

    const subData: InsertAppSubscriptionRecord = {
      id: numericId,
      shopifySubscriptionId: rawSub.admin_graphql_api_id,
      name: rawSub.name || null,
      status: rawSub.status || null,
      adminGraphqlApiId: rawSub.admin_graphql_api_id,
      test: Boolean(rawSub.test),
      trialDays: rawSub.trial_days != null ? Number(rawSub.trial_days) : null,
      currentPeriodEnd: rawSub.current_period_end ? new Date(rawSub.current_period_end) : null,
      price: pricing?.price ? parseFloat(pricing.price) : null,
      currency: pricing?.currency_code || null,
      interval: pricing?.interval || null,
      cappedAmount: pricing?.capped_amount ? parseFloat(pricing.capped_amount) : null,
      terms: pricing?.terms || null,
      lineItems: rawSub.line_items ? JSON.stringify(rawSub.line_items) : null,
      rawPayload: JSON.stringify(payload),
      shopId: shopRecord.id,
      shopifyCreatedAt: rawSub.created_at ? new Date(rawSub.created_at) : null,
      shopifyUpdatedAt: rawSub.updated_at ? new Date(rawSub.updated_at) : null,
      updatedAt: new Date(),
    };

    const updateSet = { ...subData };
    delete (updateSet as any).id;

    await db
      .insert(appSubscriptions)
      .values(subData)
      .onConflictDoUpdate({
        target: appSubscriptions.shopifySubscriptionId,
        set: updateSet,
      });

    const savedSub = await db.query.appSubscriptions.findFirst({
      where: eq(appSubscriptions.shopifySubscriptionId, rawSub.admin_graphql_api_id),
    });

    shopLogger.info(`Successfully updated app subscription status to '${rawSub.status}' via webhook`, {
      subscriptionId: rawSub.admin_graphql_api_id,
      status: rawSub.status,
    });

    return savedSub || null;
  } catch (error: any) {
    shopLogger.error(`Exception occurred during subscription webhook processing for ${shopDomain}`, {
      error,
    });
    return null;
  }
}

export async function getActiveAppSubscriptions(
  shopId: string,
  db: AppDb,
): Promise<AppSubscriptionRecord[]> {
  return db.query.appSubscriptions.findMany({
    where: eq(appSubscriptions.shopId, shopId),
  });
}
