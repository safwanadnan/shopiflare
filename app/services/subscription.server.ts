import type { PrismaClient } from "@prisma/client";
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
      appSubscription {
        id
        name
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

export const APP_SUBSCRIPTION_CANCEL_MUTATION = `#graphql
  mutation AppSubscriptionCancel($id: ID!, $prorate: Boolean) {
    appSubscriptionCancel(id: $id, prorate: $prorate) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface CreateSubscriptionOptions {
  name: string;
  price: number;
  interval?: "EVERY_30_DAYS" | "ANNUAL";
  returnUrl: string;
  test?: boolean;
  trialDays?: number;
}

/**
 * Synchronizes active app subscriptions from Shopify GraphQL Admin into the database.
 */
export async function syncAppSubscriptionsFromGraphql(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  shopifyDomain: string,
  prisma: PrismaClient,
) {
  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain },
    });

    if (!shop) {
      logger.warn(`Cannot sync subscriptions because Shop record does not exist for domain ${shopifyDomain}`, {
        shopDomain: shopifyDomain,
      });
      return [];
    }

    const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
    const json = (await response.json()) as any;
    const activeSubscriptions = json?.data?.appInstallation?.activeSubscriptions || [];

    const syncedSubscriptions = [];

    for (const sub of activeSubscriptions) {
      let price: number | null = null;
      let currency: string | null = null;
      let interval: string | null = null;
      let cappedAmount: number | null = null;
      let terms: string | null = null;

      if (Array.isArray(sub.lineItems)) {
        for (const item of sub.lineItems) {
          const pricing = item.plan?.pricingDetails;
          if (pricing?.__typename === "AppRecurringPricing") {
            price = pricing.price?.amount ? parseFloat(pricing.price.amount) : null;
            currency = pricing.price?.currencyCode || null;
            interval = pricing.interval || null;
          } else if (pricing?.__typename === "AppUsagePricing") {
            cappedAmount = pricing.cappedAmount?.amount ? parseFloat(pricing.cappedAmount.amount) : null;
            terms = pricing.terms || null;
          }
        }
      }

      const subscriptionData = {
        shopifySubscriptionId: String(sub.id),
        adminGraphqlApiId: String(sub.id),
        name: sub.name || null,
        status: sub.status || "ACTIVE",
        test: Boolean(sub.test),
        trialDays: sub.trialDays != null ? Number(sub.trialDays) : null,
        currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
        price,
        currency,
        interval,
        cappedAmount,
        terms,
        lineItems: sub.lineItems || null,
        rawPayload: sub,
        shopId: shop.id,
        shopifyCreatedAt: sub.createdAt ? new Date(sub.createdAt) : null,
      };

      const record = await prisma.appSubscription.upsert({
        where: { shopifySubscriptionId: String(sub.id) },
        create: subscriptionData,
        update: subscriptionData,
      });

      syncedSubscriptions.push(record);
    }

    // Update Shop plan details if an active subscription exists
    if (syncedSubscriptions.length > 0) {
      const primarySub = syncedSubscriptions[0];
      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          planName: primarySub.name,
          planDisplayName: primarySub.name,
        },
      });
    }

    logger.info(`Successfully synced ${syncedSubscriptions.length} active app subscription(s) from Shopify GraphQL for ${shopifyDomain}`, {
      shopId: shop.id,
      shopDomain: shopifyDomain,
      count: syncedSubscriptions.length,
    });
    return syncedSubscriptions;
  } catch (error: any) {
    logger.error(`Failed to sync active app subscriptions from Shopify GraphQL for ${shopifyDomain}`, {
      shopDomain: shopifyDomain,
      error,
    });
    return [];
  }
}

/**
 * Handles incoming app_subscriptions/update webhook payloads.
 */
export async function processAppSubscriptionWebhook(
  payload: Record<string, any>,
  shopifyDomain: string,
  prisma: PrismaClient,
) {
  try {
    const sub = payload.app_subscription || payload;
    if (!sub || typeof sub !== "object") return null;

    const subId = String(sub.admin_graphql_api_id || sub.id);
    if (!subId) {
      logger.warn(`Received app_subscriptions/update webhook payload missing subscription ID for ${shopifyDomain}`, {
        shopDomain: shopifyDomain,
      });
      return null;
    }

    // Resolve shop by domain or numeric shop id
    const rawShopId = String(sub.admin_graphql_api_shop_id || "").replace(/^gid:\/\/shopify\/Shop\//, "");
    const shop = await prisma.shop.findFirst({
      where: {
        OR: [
          { shopifyDomain },
          ...(rawShopId ? [{ id: rawShopId }] : []),
        ],
      },
    });

    if (!shop) {
      logger.warn(`Received app_subscriptions/update webhook but no matching Shop found for domain ${shopifyDomain}`, {
        shopId: rawShopId || null,
        shopDomain: shopifyDomain,
      });
      return null;
    }

    let price: number | null = null;
    let currency: string | null = sub.currency || null;
    let interval: string | null = null;
    let cappedAmount: number | null = sub.capped_amount ? parseFloat(sub.capped_amount) : null;
    let terms: string | null = null;

    if (Array.isArray(sub.line_items)) {
      for (const item of sub.line_items) {
        const pricing = item.plan?.pricing_details || item.plan?.pricingDetails;
        if (pricing) {
          if (pricing.price) {
            price = pricing.price.amount ? parseFloat(pricing.price.amount) : null;
            currency = pricing.price.currency_code || pricing.price.currencyCode || currency;
          }
          interval = pricing.interval || interval;
          if (pricing.capped_amount) {
            cappedAmount = parseFloat(pricing.capped_amount.amount || pricing.capped_amount);
          }
          terms = pricing.terms || terms;
        }
      }
    }

    const subscriptionData = {
      shopifySubscriptionId: subId,
      adminGraphqlApiId: String(sub.admin_graphql_api_id || sub.id),
      name: sub.name || null,
      status: sub.status || "ACTIVE",
      test: Boolean(sub.test),
      trialDays: sub.trial_days != null ? Number(sub.trial_days) : null,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
      price,
      currency,
      interval,
      cappedAmount,
      terms,
      lineItems: sub.line_items || null,
      rawPayload: sub,
      shopId: shop.id,
      shopifyCreatedAt: sub.created_at ? new Date(sub.created_at) : null,
      shopifyUpdatedAt: sub.updated_at ? new Date(sub.updated_at) : null,
    };

    const record = await prisma.appSubscription.upsert({
      where: { shopifySubscriptionId: subId },
      create: subscriptionData,
      update: subscriptionData,
    });

    // If active, update Shop plan
    if (sub.status === "ACTIVE" && sub.name) {
      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          planName: sub.name,
          planDisplayName: sub.name,
        },
      });
    }

    logger.info(`Successfully processed app_subscriptions/update webhook for subscription ${subId} (status: ${sub.status}) on ${shopifyDomain}`, {
      shopId: shop.id,
      shopDomain: shopifyDomain,
      subscriptionId: subId,
      status: sub.status,
      planName: sub.name,
    });
    return record;
  } catch (error: any) {
    logger.error(`Failed to process app_subscriptions/update webhook for ${shopifyDomain}`, {
      shopDomain: shopifyDomain,
      error,
    });
    return null;
  }
}

/**
 * Gets the current active AppSubscription for a shop.
 */
export async function getActiveSubscription(
  shopifyDomain: string,
  prisma: PrismaClient,
) {
  return prisma.appSubscription.findFirst({
    where: {
      shop: { shopifyDomain },
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Initiates a new AppSubscription on Shopify via GraphQL Admin API.
 */
export async function createAppSubscription(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  options: CreateSubscriptionOptions,
) {
  const { name, price, interval = "EVERY_30_DAYS", returnUrl, test = false, trialDays = 0 } = options;

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
                currencyCode: "USD",
              },
              interval,
            },
          },
        },
      ],
    },
  });

  const json = (await response.json()) as any;
  const result = json?.data?.appSubscriptionCreate;

  if (result?.userErrors && result.userErrors.length > 0) {
    throw new Error(`[SubscriptionCreate] ${result.userErrors.map((e: any) => e.message).join(", ")}`);
  }

  return {
    appSubscription: result?.appSubscription,
    confirmationUrl: result?.confirmationUrl,
  };
}

/**
 * Cancels an AppSubscription on Shopify via GraphQL Admin API.
 */
export async function cancelAppSubscription(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  subscriptionId: string,
  prorate: boolean = true,
) {
  const response = await admin.graphql(APP_SUBSCRIPTION_CANCEL_MUTATION, {
    variables: {
      id: subscriptionId.startsWith("gid://") ? subscriptionId : `gid://shopify/AppSubscription/${subscriptionId}`,
      prorate,
    },
  });

  const json = (await response.json()) as any;
  const result = json?.data?.appSubscriptionCancel;

  if (result?.userErrors && result.userErrors.length > 0) {
    throw new Error(`[SubscriptionCancel] ${result.userErrors.map((e: any) => e.message).join(", ")}`);
  }

  return result?.appSubscription;
}
