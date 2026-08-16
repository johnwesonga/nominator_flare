-- Synthetic local/preview data only. Never load this file into production.
-- Remove the exact pre-Phase-10 fake records so an existing preview database
-- can be upgraded from non-UUID identifiers without touching real rows.
DELETE FROM notification_deliveries WHERE campaign_id = 'campaign-1';
DELETE FROM notification_campaign_keys WHERE campaign_id = 'campaign-1';
DELETE FROM notification_campaigns WHERE id = 'campaign-1';
DELETE FROM votes WHERE id = 'vote-1';
DELETE FROM swimmers WHERE id IN ('swimmer-1', 'swimmer-2', 'swimmer-3');
DELETE FROM families WHERE id IN ('family-1', 'family-2');

INSERT OR IGNORE INTO families (id, email, family_token, created_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'parent.one@example.com', '10000000-0000-4000-8000-000000000001', '2026-08-14T00:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000002', 'parent.two@example.com', '10000000-0000-4000-8000-000000000002', '2026-08-14T00:00:00.000Z');

INSERT OR IGNORE INTO swimmers (id, family_id, name, group_name, created_at) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Ada Example', 'Sharks', '2026-08-14T00:00:00.000Z'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Grace Example', 'Dolphins', '2026-08-14T00:00:00.000Z'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'Lin Example', NULL, '2026-08-14T00:00:00.000Z');

INSERT OR IGNORE INTO votes (id, voter_id, candidate_id, created_at)
VALUES ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '2026-08-14T00:00:00.000Z');

INSERT OR IGNORE INTO admins (email, created_at)
VALUES ('manager@example.com', '2026-08-14T00:00:00.000Z');

INSERT OR IGNORE INTO notification_campaigns (
  id, created_by, created_at, status, total, queued, sent, failed
) VALUES (
  '40000000-0000-4000-8000-000000000001', 'manager@example.com', '2026-08-14T00:00:00.000Z',
  'completed', 2, 0, 2, 0
);

INSERT OR IGNORE INTO notification_deliveries (
  campaign_id, family_id, status, provider_message_id, attempts, updated_at
) VALUES
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'sent', 'provider-1', 1, '2026-08-14T00:00:00.000Z'),
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'sent', 'provider-2', 1, '2026-08-14T00:00:00.000Z');
