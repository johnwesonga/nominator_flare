-- Queue-backed parent notification tracking.

CREATE TABLE notification_campaigns (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'sending', 'completed', 'failed')
  ),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  queued INTEGER NOT NULL DEFAULT 0 CHECK (queued >= 0),
  sent INTEGER NOT NULL DEFAULT 0 CHECK (sent >= 0),
  failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  CONSTRAINT notification_campaign_counts CHECK (
    queued + sent + failed = total
  )
) STRICT;

CREATE TABLE notification_deliveries (
  campaign_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'sending', 'sent', 'failed')
  ),
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, family_id),
  CONSTRAINT notification_deliveries_campaign_fk
    FOREIGN KEY (campaign_id)
    REFERENCES notification_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT notification_deliveries_family_fk
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX one_active_notification_campaign_idx
ON notification_campaigns ((1))
WHERE status IN ('queued', 'sending');

CREATE INDEX notification_deliveries_status_idx
ON notification_deliveries(campaign_id, status);
