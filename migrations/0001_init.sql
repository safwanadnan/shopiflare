-- 1. Session Table
CREATE TABLE IF NOT EXISTS "Session" (
  "id" text PRIMARY KEY NOT NULL,
  "shop" text NOT NULL,
  "state" text NOT NULL,
  "isOnline" integer DEFAULT false NOT NULL,
  "scope" text,
  "expires" datetime,
  "accessToken" text NOT NULL,
  "userId" integer,
  "firstName" text,
  "lastName" text,
  "email" text,
  "accountOwner" integer DEFAULT false NOT NULL,
  "locale" text,
  "collaborator" integer DEFAULT false,
  "emailVerified" integer DEFAULT false,
  "refreshToken" text,
  "refreshTokenExpires" datetime
);
CREATE INDEX IF NOT EXISTS "Session_shop_idx" ON "Session" ("shop");

-- 2. Shop Table
CREATE TABLE IF NOT EXISTS "Shop" (
  "id" text PRIMARY KEY NOT NULL,
  "shopifyDomain" text NOT NULL,
  "domain" text,
  "name" text,
  "email" text,
  "contactEmail" text,
  "shopOwner" text,
  "currency" text,
  "planName" text,
  "planDisplayName" text,
  "isPlus" integer DEFAULT false,
  "isPartnerDevelopment" integer DEFAULT false,
  "ianaTimezone" text,
  "timezone" text,
  "timezoneOffset" text,
  "unitSystem" text,
  "weightUnit" text,
  "primaryLocale" text,
  "address1" text,
  "address2" text,
  "city" text,
  "province" text,
  "provinceCode" text,
  "country" text,
  "countryCode" text,
  "countryName" text,
  "zip" text,
  "phone" text,
  "latitude" real,
  "longitude" real,
  "customerAccounts" text,
  "checkoutApiSupported" integer DEFAULT false,
  "taxesIncluded" integer DEFAULT false,
  "taxShipping" integer DEFAULT false,
  "setupRequired" integer DEFAULT false,
  "marketingSmsConsentEnabledAtCheckout" integer DEFAULT false,
  "transactionalSmsDisabled" integer DEFAULT false,
  "enabledPresentmentCurrencies" text,
  "currencyFormats" text,
  "accessToken" text,
  "scope" text,
  "installedAt" datetime DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  "uninstalledAt" datetime,
  "featureFlags" text,
  "rawShopData" text,
  "shopifyCreatedAt" datetime,
  "shopifyUpdatedAt" datetime,
  "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  "updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopifyDomain_key" ON "Shop" ("shopifyDomain");
CREATE INDEX IF NOT EXISTS "Shop_shopifyDomain_idx" ON "Shop" ("shopifyDomain");

-- 3. AppSubscription Table
CREATE TABLE IF NOT EXISTS "AppSubscription" (
  "id" text PRIMARY KEY NOT NULL,
  "shopifySubscriptionId" text NOT NULL,
  "name" text,
  "status" text,
  "adminGraphqlApiId" text,
  "test" integer DEFAULT false,
  "trialDays" integer,
  "currentPeriodEnd" datetime,
  "price" real,
  "currency" text,
  "interval" text,
  "cappedAmount" real,
  "terms" text,
  "lineItems" text,
  "rawPayload" text,
  "shopId" text NOT NULL,
  "shopifyCreatedAt" datetime,
  "shopifyUpdatedAt" datetime,
  "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  "updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "AppSubscription_shopifySubscriptionId_key" ON "AppSubscription" ("shopifySubscriptionId");
CREATE INDEX IF NOT EXISTS "AppSubscription_shopId_idx" ON "AppSubscription" ("shopId");
CREATE INDEX IF NOT EXISTS "AppSubscription_shopifySubscriptionId_idx" ON "AppSubscription" ("shopifySubscriptionId");
CREATE INDEX IF NOT EXISTS "AppSubscription_status_idx" ON "AppSubscription" ("status");

-- 4. ShopifyGdprRequest Table
CREATE TABLE IF NOT EXISTS "ShopifyGdprRequest" (
  "id" text PRIMARY KEY NOT NULL,
  "shopId" text,
  "shopDomain" text,
  "topic" text NOT NULL,
  "payload" text,
  "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  "updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "ShopifyGdprRequest_shopId_idx" ON "ShopifyGdprRequest" ("shopId");
CREATE INDEX IF NOT EXISTS "ShopifyGdprRequest_shopDomain_idx" ON "ShopifyGdprRequest" ("shopDomain");
CREATE INDEX IF NOT EXISTS "ShopifyGdprRequest_topic_idx" ON "ShopifyGdprRequest" ("topic");
