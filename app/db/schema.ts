import { sql, relations } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/sqlite-core";

/**
 * Custom DateTime handler for SQLite that cleanly accepts/returns Date objects,
 * while safely parsing ISO strings, timestamps, or SQLite CURRENT_TIMESTAMP strings.
 */
export const sqliteDateTime = customType<{
  data: Date;
  driverData: string | number | null;
}>({
  dataType() {
    return "datetime";
  },
  toDriver(value: Date | string | number | null | undefined): string | null {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value.toISOString();
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  },
  fromDriver(value: string | number | null): Date {
    if (value === null || value === undefined || value === "") return new Date(0);
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date(0) : d;
  },
});

// 1. Session Table (Shopify App Authentication Sessions)
export const sessions = sqliteTable(
  "Session",
  {
    id: text("id").primaryKey(),
    shop: text("shop").notNull(),
    state: text("state").notNull(),
    isOnline: integer("isOnline", { mode: "boolean" }).notNull().default(false),
    scope: text("scope"),
    expires: sqliteDateTime("expires"),
    accessToken: text("accessToken").notNull(),
    userId: integer("userId"),
    firstName: text("firstName"),
    lastName: text("lastName"),
    email: text("email"),
    accountOwner: integer("accountOwner", { mode: "boolean" }).notNull().default(false),
    locale: text("locale"),
    collaborator: integer("collaborator", { mode: "boolean" }).default(false),
    emailVerified: integer("emailVerified", { mode: "boolean" }).default(false),
    refreshToken: text("refreshToken"),
    refreshTokenExpires: sqliteDateTime("refreshTokenExpires"),
  },
  (table) => [
    index("Session_shop_idx").on(table.shop),
  ],
);

// 2. Shop Table (Core Merchant Store State & Metadata)
export const shops = sqliteTable(
  "Shop",
  {
    id: text("id").primaryKey(),
    shopifyDomain: text("shopifyDomain").notNull(),
    domain: text("domain"),
    name: text("name"),
    email: text("email"),
    contactEmail: text("contactEmail"),
    shopOwner: text("shopOwner"),
    currency: text("currency"),
    planName: text("planName"),
    planDisplayName: text("planDisplayName"),
    isPlus: integer("isPlus", { mode: "boolean" }).default(false),
    isPartnerDevelopment: integer("isPartnerDevelopment", { mode: "boolean" }).default(false),
    ianaTimezone: text("ianaTimezone"),
    timezone: text("timezone"),
    timezoneOffset: text("timezoneOffset"),
    unitSystem: text("unitSystem"),
    weightUnit: text("weightUnit"),
    primaryLocale: text("primaryLocale"),

    // Address & Phone
    address1: text("address1"),
    address2: text("address2"),
    city: text("city"),
    province: text("province"),
    provinceCode: text("provinceCode"),
    country: text("country"),
    countryCode: text("countryCode"),
    countryName: text("countryName"),
    zip: text("zip"),
    phone: text("phone"),
    latitude: real("latitude"),
    longitude: real("longitude"),

    // Settings & Capabilities
    customerAccounts: text("customerAccounts"),
    checkoutApiSupported: integer("checkoutApiSupported", { mode: "boolean" }).default(false),
    taxesIncluded: integer("taxesIncluded", { mode: "boolean" }).default(false),
    taxShipping: integer("taxShipping", { mode: "boolean" }).default(false),
    setupRequired: integer("setupRequired", { mode: "boolean" }).default(false),
    marketingSmsConsentEnabledAtCheckout: integer("marketingSmsConsentEnabledAtCheckout", { mode: "boolean" }).default(false),
    transactionalSmsDisabled: integer("transactionalSmsDisabled", { mode: "boolean" }).default(false),
    enabledPresentmentCurrencies: text("enabledPresentmentCurrencies", { mode: "json" }),
    currencyFormats: text("currencyFormats", { mode: "json" }),

    // App credentials & lifecycle
    accessToken: text("accessToken"),
    scope: text("scope"),
    installedAt: sqliteDateTime("installedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    uninstalledAt: sqliteDateTime("uninstalledAt"),
    featureFlags: text("featureFlags", { mode: "json" }),

    // Complete raw payload snapshot for forward-compatibility
    rawShopData: text("rawShopData", { mode: "json" }),

    shopifyCreatedAt: sqliteDateTime("shopifyCreatedAt"),
    shopifyUpdatedAt: sqliteDateTime("shopifyUpdatedAt"),

    createdAt: sqliteDateTime("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: sqliteDateTime("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("Shop_shopifyDomain_key").on(table.shopifyDomain),
    index("Shop_shopifyDomain_idx").on(table.shopifyDomain),
  ],
);

// 3. AppSubscription Table (Shopify Billing & Subscriptions)
export const appSubscriptions = sqliteTable(
  "AppSubscription",
  {
    id: text("id").primaryKey(),
    shopifySubscriptionId: text("shopifySubscriptionId").notNull(),
    name: text("name"),
    status: text("status"),
    adminGraphqlApiId: text("adminGraphqlApiId"),
    test: integer("test", { mode: "boolean" }).default(false),
    trialDays: integer("trialDays"),
    currentPeriodEnd: sqliteDateTime("currentPeriodEnd"),
    price: real("price"),
    currency: text("currency"),
    interval: text("interval"),
    cappedAmount: real("cappedAmount"),
    terms: text("terms"),
    lineItems: text("lineItems", { mode: "json" }),
    rawPayload: text("rawPayload", { mode: "json" }),
    shopId: text("shopId").notNull().references(() => shops.id, { onDelete: "cascade" }),
    shopifyCreatedAt: sqliteDateTime("shopifyCreatedAt"),
    shopifyUpdatedAt: sqliteDateTime("shopifyUpdatedAt"),
    createdAt: sqliteDateTime("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: sqliteDateTime("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("AppSubscription_shopifySubscriptionId_key").on(table.shopifySubscriptionId),
    index("AppSubscription_shopId_idx").on(table.shopId),
    index("AppSubscription_shopifySubscriptionId_idx").on(table.shopifySubscriptionId),
    index("AppSubscription_status_idx").on(table.status),
  ],
);

// 4. ShopifyGdprRequest Table (GDPR Compliance Audit Log)
export const shopifyGdprRequests = sqliteTable(
  "ShopifyGdprRequest",
  {
    id: text("id").primaryKey(),
    shopId: text("shopId").references(() => shops.id, { onDelete: "cascade" }),
    shopDomain: text("shopDomain"),
    topic: text("topic").notNull(),
    payload: text("payload", { mode: "json" }),
    createdAt: sqliteDateTime("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: sqliteDateTime("updatedAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("ShopifyGdprRequest_shopId_idx").on(table.shopId),
    index("ShopifyGdprRequest_shopDomain_idx").on(table.shopDomain),
    index("ShopifyGdprRequest_topic_idx").on(table.topic),
  ],
);

// ==========================================
// Relations
// ==========================================
export const shopsRelations = relations(shops, ({ many }) => ({
  appSubscriptions: many(appSubscriptions),
  shopifyGdprRequests: many(shopifyGdprRequests),
}));

export const appSubscriptionsRelations = relations(appSubscriptions, ({ one }) => ({
  shop: one(shops, {
    fields: [appSubscriptions.shopId],
    references: [shops.id],
  }),
}));

export const shopifyGdprRequestsRelations = relations(shopifyGdprRequests, ({ one }) => ({
  shop: one(shops, {
    fields: [shopifyGdprRequests.shopId],
    references: [shops.id],
  }),
}));

// ==========================================
// Inferred TypeScript Model Types
// ==========================================
export type SessionRecord = typeof sessions.$inferSelect;
export type InsertSessionRecord = typeof sessions.$inferInsert;

export type ShopRecord = typeof shops.$inferSelect;
export type InsertShopRecord = typeof shops.$inferInsert;

export type AppSubscriptionRecord = typeof appSubscriptions.$inferSelect;
export type InsertAppSubscriptionRecord = typeof appSubscriptions.$inferInsert;

export type ShopifyGdprRequestRecord = typeof shopifyGdprRequests.$inferSelect;
export type InsertShopifyGdprRequestRecord = typeof shopifyGdprRequests.$inferInsert;
