CREATE TABLE `ShopifyAuthState` (
	`shop` text PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`authorizedAt` integer DEFAULT 0 NOT NULL,
	`uninstalledAt` text,
	`leaseToken` text,
	`leaseExpiresAt` integer DEFAULT 0 NOT NULL
);

-- Preserve existing uninstall markers. A legacy shop's authorization time is
-- unknown until its first coordinated embedded token exchange.
INSERT INTO ShopifyAuthState (shop, uninstalledAt)
SELECT shopifyDomain, uninstalledAt FROM Shop
WHERE uninstalledAt IS NOT NULL;
