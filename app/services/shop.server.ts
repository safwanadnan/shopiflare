import { eq } from "drizzle-orm";
import type { AppDb } from "../db.server";
import { shops, type ShopRecord, type InsertShopRecord } from "../db/schema";
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
    }
  }
`;

export interface AuthSessionCredentials {
  accessToken?: string;
  scope?: string;
}

export async function resolveShop(
  db: AppDb,
  identifiers: { shopId?: string | null; shopDomain?: string | null },
): Promise<ShopRecord | null> {
  if (identifiers.shopId) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, identifiers.shopId),
    });
    if (shop) return shop;
  }

  if (identifiers.shopDomain) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.shopifyDomain, identifiers.shopDomain),
    });
    if (shop) return shop;
  }

  return null;
}

export async function enrichShopFromGraphql(
  admin: { graphql: (query: string, options?: any) => Promise<any> },
  shopDomain: string,
  db: AppDb,
  authCredentials?: AuthSessionCredentials,
): Promise<ShopRecord | null> {
  const shopLogger = logger.withContext({ shopDomain });
  try {
    const response = await admin.graphql(SHOP_ENRICHMENT_QUERY);
    const json = await response.json();

    if (json.errors && json.errors.length > 0) {
      shopLogger.error("GraphQL errors while executing ShopEnrichment query", {
        errors: json.errors,
      });
      return null;
    }

    const rawShop = json?.data?.shop;
    if (!rawShop || !rawShop.id) {
      shopLogger.warn("ShopEnrichment returned empty or malformed shop data payload", { rawShop });
      return null;
    }

    const numericShopId = rawShop.id.replace(/\D/g, "");
    const plan = rawShop.plan || {};
    const billing = rawShop.billingAddress || {};

    const shopData: InsertShopRecord = {
      id: numericShopId,
      shopifyDomain: shopDomain,
      domain: rawShop.primaryDomain?.host || null,
      name: rawShop.name || null,
      email: rawShop.email || null,
      contactEmail: rawShop.contactEmail || null,
      shopOwner: rawShop.shopOwnerName || null,
      currency: rawShop.currencyCode || null,
      planName: plan.displayName || null,
      planDisplayName: plan.displayName || null,
      isPlus: Boolean(plan.shopifyPlus),
      isPartnerDevelopment: Boolean(plan.partnerDevelopment),
      ianaTimezone: rawShop.ianaTimezone || null,
      timezone: rawShop.timezoneAbbreviation || null,
      timezoneOffset: rawShop.timezoneOffset ? String(rawShop.timezoneOffset) : null,
      unitSystem: rawShop.unitSystem || null,
      weightUnit: rawShop.weightUnit || null,
      primaryLocale: null,

      address1: billing.address1 || null,
      address2: billing.address2 || null,
      city: billing.city || null,
      province: billing.province || null,
      provinceCode: billing.provinceCode || null,
      country: billing.country || null,
      countryCode: billing.countryCodeV2 || null,
      countryName: billing.country || null,
      zip: billing.zip || null,
      phone: billing.phone || null,
      latitude: billing.latitude != null ? Number(billing.latitude) : null,
      longitude: billing.longitude != null ? Number(billing.longitude) : null,

      customerAccounts: rawShop.customerAccounts || null,
      checkoutApiSupported: Boolean(rawShop.checkoutApiSupported),
      taxesIncluded: Boolean(rawShop.taxesIncluded),
      taxShipping: Boolean(rawShop.taxShipping),
      setupRequired: Boolean(rawShop.setupRequired),
      marketingSmsConsentEnabledAtCheckout: Boolean(rawShop.marketingSmsConsentEnabledAtCheckout),
      transactionalSmsDisabled: Boolean(rawShop.transactionalSmsDisabled),
      enabledPresentmentCurrencies: Array.isArray(rawShop.enabledPresentmentCurrencies)
        ? JSON.stringify(rawShop.enabledPresentmentCurrencies)
        : null,
      currencyFormats: rawShop.currencyFormats ? JSON.stringify(rawShop.currencyFormats) : null,

      accessToken: authCredentials?.accessToken || null,
      scope: authCredentials?.scope || null,
      uninstalledAt: null,

      rawShopData: JSON.stringify(rawShop),

      shopifyCreatedAt: rawShop.createdAt ? new Date(rawShop.createdAt) : null,
      shopifyUpdatedAt: rawShop.updatedAt ? new Date(rawShop.updatedAt) : null,
      updatedAt: new Date(),
    };

    const updateSet = { ...shopData };
    delete (updateSet as any).id;

    await db
      .insert(shops)
      .values(shopData)
      .onConflictDoUpdate({
        target: shops.shopifyDomain,
        set: updateSet,
      });

    const savedShop = await db.query.shops.findFirst({
      where: eq(shops.shopifyDomain, shopDomain),
    });

    shopLogger.info(`Successfully enriched and synchronized store profile for ${shopDomain}`, {
      shopId: numericShopId,
      plan: plan.displayName || "Unknown",
      currency: rawShop.currencyCode,
    });

    return savedShop || null;
  } catch (error: any) {
    shopLogger.error(`Exception occurred during store profile enrichment for ${shopDomain}`, {
      error,
    });
    return null;
  }
}

export async function enrichShopFromWebhookPayload(
  payload: any,
  shopDomain: string,
  db: AppDb,
): Promise<ShopRecord | null> {
  const shopLogger = logger.withContext({ shopDomain });
  try {
    if (!payload || !payload.id) {
      shopLogger.warn("Shop webhook payload does not contain a valid ID", { payload });
      return null;
    }

    const numericShopId = String(payload.id).replace(/\D/g, "");

    const shopData: InsertShopRecord = {
      id: numericShopId,
      shopifyDomain: shopDomain,
      domain: payload.domain || null,
      name: payload.name || null,
      email: payload.email || null,
      contactEmail: payload.customer_email || payload.email || null,
      shopOwner: payload.shop_owner || null,
      currency: payload.currency || null,
      planName: payload.plan_name || null,
      planDisplayName: payload.plan_display_name || payload.plan_name || null,
      ianaTimezone: payload.iana_timezone || null,
      timezone: payload.timezone || null,
      timezoneOffset: payload.timezone_offset ? String(payload.timezone_offset) : null,
      unitSystem: payload.unit_system || null,
      weightUnit: payload.weight_unit || null,
      primaryLocale: payload.primary_locale || null,

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

      customerAccounts: payload.customer_accounts || null,
      checkoutApiSupported: Boolean(payload.checkout_api_supported),
      taxesIncluded: Boolean(payload.taxes_included),
      taxShipping: Boolean(payload.tax_shipping),
      setupRequired: Boolean(payload.setup_required),
      marketingSmsConsentEnabledAtCheckout: Boolean(payload.marketing_sms_consent_enabled_at_checkout),
      transactionalSmsDisabled: Boolean(payload.transactional_sms_disabled),
      enabledPresentmentCurrencies: Array.isArray(payload.enabled_presentment_currencies)
        ? JSON.stringify(payload.enabled_presentment_currencies)
        : null,

      uninstalledAt: null,
      rawShopData: JSON.stringify(payload),

      shopifyCreatedAt: payload.created_at ? new Date(payload.created_at) : null,
      shopifyUpdatedAt: payload.updated_at ? new Date(payload.updated_at) : null,
      updatedAt: new Date(),
    };

    const updateSet = { ...shopData };
    delete (updateSet as any).id;

    await db
      .insert(shops)
      .values(shopData)
      .onConflictDoUpdate({
        target: shops.shopifyDomain,
        set: updateSet,
      });

    const savedShop = await db.query.shops.findFirst({
      where: eq(shops.shopifyDomain, shopDomain),
    });

    shopLogger.info(`Successfully updated store profile from shop/update webhook for ${shopDomain}`, {
      shopId: numericShopId,
      plan: payload.plan_display_name || payload.plan_name || "Unknown",
    });

    return savedShop || null;
  } catch (error: any) {
    shopLogger.error(`Exception during shop webhook payload synchronization for ${shopDomain}`, {
      error,
    });
    return null;
  }
}
