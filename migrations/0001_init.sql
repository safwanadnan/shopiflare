-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "domain" TEXT,
    "name" TEXT,
    "email" TEXT,
    "contactEmail" TEXT,
    "shopOwner" TEXT,
    "currency" TEXT,
    "planName" TEXT,
    "planDisplayName" TEXT,
    "isPlus" BOOLEAN DEFAULT 0,
    "isPartnerDevelopment" BOOLEAN DEFAULT 0,
    "ianaTimezone" TEXT,
    "timezone" TEXT,
    "timezoneOffset" TEXT,
    "unitSystem" TEXT,
    "weightUnit" TEXT,
    "primaryLocale" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "provinceCode" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "countryName" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "customerAccounts" TEXT,
    "checkoutApiSupported" BOOLEAN DEFAULT 0,
    "taxesIncluded" BOOLEAN DEFAULT 0,
    "taxShipping" BOOLEAN DEFAULT 0,
    "setupRequired" BOOLEAN DEFAULT 0,
    "marketingSmsConsentEnabledAtCheckout" BOOLEAN DEFAULT 0,
    "transactionalSmsDisabled" BOOLEAN DEFAULT 0,
    "enabledPresentmentCurrencies" JSONB,
    "currencyFormats" JSONB,
    "accessToken" TEXT,
    "scope" TEXT,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "featureFlags" JSONB,
    "rawShopData" JSONB,
    "shopifyCreatedAt" DATETIME,
    "shopifyUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: AppSubscription
CREATE TABLE IF NOT EXISTS "AppSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifySubscriptionId" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "adminGraphqlApiId" TEXT,
    "test" BOOLEAN DEFAULT 0,
    "trialDays" INTEGER,
    "currentPeriodEnd" DATETIME,
    "price" REAL,
    "currency" TEXT,
    "interval" TEXT,
    "cappedAmount" REAL,
    "terms" TEXT,
    "lineItems" JSONB,
    "rawPayload" JSONB,
    "shopId" TEXT NOT NULL,
    "shopifyCreatedAt" DATETIME,
    "shopifyUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: ShopifyGdprRequest
CREATE TABLE IF NOT EXISTS "ShopifyGdprRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT,
    "shopDomain" TEXT,
    "topic" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShopifyGdprRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Shop_shopifyDomain_idx" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AppSubscription_shopifySubscriptionId_key" ON "AppSubscription"("shopifySubscriptionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppSubscription_shopId_idx" ON "AppSubscription"("shopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppSubscription_shopifySubscriptionId_idx" ON "AppSubscription"("shopifySubscriptionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppSubscription_status_idx" ON "AppSubscription"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopifyGdprRequest_shopId_idx" ON "ShopifyGdprRequest"("shopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopifyGdprRequest_shopDomain_idx" ON "ShopifyGdprRequest"("shopDomain");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopifyGdprRequest_topic_idx" ON "ShopifyGdprRequest"("topic");
