import type { PrismaClient } from "@prisma/client";
import { logger } from "./logger.server";

export const SHOP_ENRICHMENT_QUERY = `#graphql
  query ShopEnrichment {
    shop {
      id
      name
      email
      contactEmail
      shopOwnerName
      myshopifyDomain
      primaryDomain {
        host
        url
        id
      }
      currencyCode
      enabledPresentmentCurrencies
      currencyFormats {
        moneyFormat
        moneyInEmailsFormat
        moneyWithCurrencyFormat
        moneyWithCurrencyInEmailsFormat
      }
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
      ianaTimezone
      timezoneAbbreviation
      timezoneOffset
      unitSystem
      weightUnit
      billingAddress {
        address1
        address2
        city
        company
        country
        countryCodeV2
        latitude
        longitude
        phone
        province
        provinceCode
        zip
      }
      customerAccounts
      checkoutApiSupported
      taxesIncluded
      taxShipping
      setupRequired
      marketingSmsConsentEnabledAtCheckout
      transactionalSmsDisabled
      createdAt
      updatedAt
      url
    }
  }
`;

interface ShopCredentials {
  accessToken?: string | null;
  scope?: string | null;
}

/**
 * Extracts the numeric Shopify ID by stripping any GID prefix (e.g. gid://shopify/Shop/12345 -> 12345).
 */
export function extractNumericShopId(rawId?: string | number | null): string | null {
  if (!rawId) return null;
  const str = String(rawId).trim();
  if (str.startsWith("gid://")) {
    const parts = str.split("/");
    return parts[parts.length - 1] || null;
  }
  return str;
}

/**
 * Resolves a Shop record from shopId or shopDomain.
 */
export async function resolveShop(
  prisma: PrismaClient,
  options: { shopId?: string | null; shopDomain?: string | null },
) {
  const { shopId, shopDomain } = options;

  if (shopId) {
    const cleanId = extractNumericShopId(shopId);
    if (cleanId) {
      const shop = await prisma.shop.findUnique({
        where: { id: cleanId },
      });
      if (shop) return shop;
    }
  }

  if (shopDomain) {
    const cleanDomain = shopDomain.toLowerCase().trim();
    return prisma.shop.findFirst({
      where: {
        OR: [
          { shopifyDomain: cleanDomain },
          { domain: cleanDomain },
        ],
      },
    });
  }

  return null;
}

/**
 * Enriches the Shop model in the database using the full GraphQL Admin query.
 */
export async function enrichShopFromGraphql(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  shopifyDomain: string,
  prisma: PrismaClient,
  credentials?: ShopCredentials,
) {
  try {
    const response = await admin.graphql(SHOP_ENRICHMENT_QUERY);
    const json = (await response.json()) as any;
    const shop = json?.data?.shop;

    if (!shop) {
      logger.warn(`Shop enrichment query returned no shop data for domain ${shopifyDomain}`, {
        shopDomain: shopifyDomain,
      });
      return null;
    }

    const numericShopId = extractNumericShopId(shop.id);

    const dataToSave = {
      shopifyDomain,
      domain: shop.primaryDomain?.host || shop.myshopifyDomain || shopifyDomain,
      name: shop.name || null,
      email: shop.email || null,
      contactEmail: shop.contactEmail || null,
      shopOwner: shop.shopOwnerName || null,
      currency: shop.currencyCode || null,
      planName: shop.plan?.displayName || null,
      planDisplayName: shop.plan?.displayName || null,
      isPlus: Boolean(shop.plan?.shopifyPlus),
      isPartnerDevelopment: Boolean(shop.plan?.partnerDevelopment),
      ianaTimezone: shop.ianaTimezone || null,
      timezone: shop.timezoneAbbreviation || null,
      timezoneOffset: shop.timezoneOffset || null,
      unitSystem: shop.unitSystem || null,
      weightUnit: shop.weightUnit || null,

      // Address
      address1: shop.billingAddress?.address1 || null,
      address2: shop.billingAddress?.address2 || null,
      city: shop.billingAddress?.city || null,
      province: shop.billingAddress?.province || null,
      provinceCode: shop.billingAddress?.provinceCode || null,
      country: shop.billingAddress?.country || null,
      countryCode: shop.billingAddress?.countryCodeV2 || null,
      countryName: shop.billingAddress?.country || null,
      zip: shop.billingAddress?.zip || null,
      phone: shop.billingAddress?.phone || null,
      latitude: shop.billingAddress?.latitude != null ? Number(shop.billingAddress.latitude) : null,
      longitude: shop.billingAddress?.longitude != null ? Number(shop.billingAddress.longitude) : null,

      // Capabilities & Flags
      customerAccounts: shop.customerAccounts || null,
      checkoutApiSupported: Boolean(shop.checkoutApiSupported),
      taxesIncluded: Boolean(shop.taxesIncluded),
      taxShipping: Boolean(shop.taxShipping),
      setupRequired: Boolean(shop.setupRequired),
      marketingSmsConsentEnabledAtCheckout: Boolean(shop.marketingSmsConsentEnabledAtCheckout),
      transactionalSmsDisabled: Boolean(shop.transactionalSmsDisabled),

      enabledPresentmentCurrencies: shop.enabledPresentmentCurrencies || null,
      currencyFormats: shop.currencyFormats || null,

      rawShopData: shop,

      shopifyCreatedAt: shop.createdAt ? new Date(shop.createdAt) : null,
      shopifyUpdatedAt: shop.updatedAt ? new Date(shop.updatedAt) : null,
      uninstalledAt: null,
      ...(credentials?.accessToken ? { accessToken: credentials.accessToken } : {}),
      ...(credentials?.scope ? { scope: credentials.scope } : {}),
    };

    // Check if shop already exists with an older ID and migrate if needed
    const existing = await prisma.shop.findUnique({
      where: { shopifyDomain },
      select: { id: true },
    });

    if (existing && numericShopId && existing.id !== numericShopId) {
      logger.info(`Migrating Shop database primary key from legacy ID ${existing.id} to numeric ID ${numericShopId}`, {
        shopId: numericShopId,
        shopDomain: shopifyDomain,
        oldId: existing.id,
      });
      await prisma.$executeRawUnsafe(`UPDATE "Shop" SET id = ? WHERE id = ?`, numericShopId, existing.id);
      await prisma.$executeRawUnsafe(`UPDATE "AppSubscription" SET shopId = ? WHERE shopId = ?`, numericShopId, existing.id);
      await prisma.$executeRawUnsafe(`UPDATE "ShopifyGdprRequest" SET shopId = ? WHERE shopId = ?`, numericShopId, existing.id);
    }

    const record = await prisma.shop.upsert({
      where: { shopifyDomain },
      create: {
        id: numericShopId || shopifyDomain,
        ...dataToSave,
      },
      update: dataToSave,
    });

    logger.info(`Successfully enriched and saved Shop data from Shopify GraphQL Admin for ${shopifyDomain}`, {
      shopId: record.id,
      shopDomain: shopifyDomain,
      plan: record.planDisplayName || null,
    });
    return record;
  } catch (error: any) {
    logger.error(`Failed to enrich Shop data from GraphQL Admin for ${shopifyDomain}`, {
      shopDomain: shopifyDomain,
      error,
    });
    return null;
  }
}

/**
 * Enriches the Shop model in the database from a shop/update webhook payload (handles REST snake_case).
 */
export async function enrichShopFromWebhookPayload(
  payload: Record<string, any>,
  shopifyDomain: string,
  prisma: PrismaClient,
) {
  try {
    if (!payload || typeof payload !== "object") return null;

    const dataToSave = {
      domain: payload.domain || payload.myshopify_domain || shopifyDomain,
      name: payload.name || null,
      email: payload.email || null,
      contactEmail: payload.customer_email || payload.email || null,
      shopOwner: payload.shop_owner || null,
      currency: payload.currency || null,
      planName: payload.plan_name || null,
      planDisplayName: payload.plan_display_name || payload.plan_name || null,
      ianaTimezone: payload.iana_timezone || null,
      timezone: payload.timezone || null,
      unitSystem: payload.unit_system || null,
      weightUnit: payload.weight_unit || null,
      primaryLocale: payload.primary_locale || null,

      // Address
      address1: payload.address1 || null,
      address2: payload.address2 || null,
      city: payload.city || null,
      province: payload.province || null,
      provinceCode: payload.province_code || null,
      country: payload.country || null,
      countryCode: payload.country_code || null,
      countryName: payload.country_name || null,
      zip: payload.zip || null,
      phone: payload.phone || null,
      latitude: payload.latitude != null ? Number(payload.latitude) : null,
      longitude: payload.longitude != null ? Number(payload.longitude) : null,

      // Capabilities & Flags
      customerAccounts: payload.customer_accounts || null,
      checkoutApiSupported: payload.checkout_api_supported != null ? Boolean(payload.checkout_api_supported) : undefined,
      taxesIncluded: payload.taxes_included != null ? Boolean(payload.taxes_included) : undefined,
      taxShipping: payload.tax_shipping != null ? Boolean(payload.tax_shipping) : undefined,
      setupRequired: payload.setup_required != null ? Boolean(payload.setup_required) : undefined,
      marketingSmsConsentEnabledAtCheckout:
        payload.marketing_sms_consent_enabled_at_checkout != null
          ? Boolean(payload.marketing_sms_consent_enabled_at_checkout)
          : undefined,
      transactionalSmsDisabled:
        payload.transactional_sms_disabled != null ? Boolean(payload.transactional_sms_disabled) : undefined,

      enabledPresentmentCurrencies: payload.enabled_presentment_currencies || null,
      currencyFormats: payload.money_format ? { moneyFormat: payload.money_format } : null,

      rawShopData: payload,

      shopifyCreatedAt: payload.created_at ? new Date(payload.created_at) : null,
      shopifyUpdatedAt: payload.updated_at ? new Date(payload.updated_at) : null,
      uninstalledAt: null,
    };

    // Filter out undefined values to avoid overwriting existing good data with undefined
    const cleanedData = Object.fromEntries(
      Object.entries(dataToSave).filter(([_, v]) => v !== undefined)
    );

    const numericShopId = extractNumericShopId(payload.id || payload.admin_graphql_api_id);

    const existing = await prisma.shop.findUnique({
      where: { shopifyDomain },
      select: { id: true },
    });

    if (existing && numericShopId && existing.id !== numericShopId) {
      logger.info(`Migrating Shop database primary key from legacy ID ${existing.id} to numeric ID ${numericShopId} via webhook`, {
        shopId: numericShopId,
        shopDomain: shopifyDomain,
        oldId: existing.id,
      });
      await prisma.$executeRawUnsafe(`UPDATE "Shop" SET id = ? WHERE id = ?`, numericShopId, existing.id);
      await prisma.$executeRawUnsafe(`UPDATE "AppSubscription" SET shopId = ? WHERE shopId = ?`, numericShopId, existing.id);
      await prisma.$executeRawUnsafe(`UPDATE "ShopifyGdprRequest" SET shopId = ? WHERE shopId = ?`, numericShopId, existing.id);
    }

    const record = await prisma.shop.upsert({
      where: { shopifyDomain },
      create: {
        id: numericShopId || shopifyDomain,
        shopifyDomain,
        ...cleanedData,
      } as any,
      update: cleanedData as any,
    });

    logger.info(`Successfully updated Shop data from shop/update webhook for ${shopifyDomain}`, {
      shopId: record.id,
      shopDomain: shopifyDomain,
      plan: record.planDisplayName || null,
    });
    return record;
  } catch (error: any) {
    logger.error(`Failed to process Shop data from shop/update webhook for ${shopifyDomain}`, {
      shopDomain: shopifyDomain,
      error,
    });
    return null;
  }
}
