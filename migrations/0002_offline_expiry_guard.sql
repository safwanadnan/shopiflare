-- Expiring offline credentials only. Existing legacy rows are ignored by the
-- storage adapter; online sessions and empty SDK invalidation rows are allowed.
CREATE TRIGGER IF NOT EXISTS Session_offline_expiry_insert
BEFORE INSERT ON Session
WHEN NEW.isOnline = 0 AND length(NEW.accessToken) > 0
  AND (NEW.expires IS NULL OR julianday(NEW.expires) IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Offline Shopify access tokens require an expiry');
END;

CREATE TRIGGER IF NOT EXISTS Session_offline_expiry_update
BEFORE UPDATE OF accessToken, expires, isOnline ON Session
WHEN NEW.isOnline = 0 AND length(NEW.accessToken) > 0
  AND (NEW.expires IS NULL OR julianday(NEW.expires) IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Offline Shopify access tokens require an expiry');
END;
