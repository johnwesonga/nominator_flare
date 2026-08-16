-- Permanent idempotency key for one notification campaign per configured season.

CREATE TABLE notification_campaign_keys (
  campaign_key TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE,
  CONSTRAINT notification_campaign_keys_campaign_fk
    FOREIGN KEY (campaign_id)
    REFERENCES notification_campaigns(id) ON DELETE CASCADE
) STRICT;
