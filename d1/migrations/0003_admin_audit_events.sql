-- Durable audit trail for Access-authenticated administrative mutations.

CREATE TABLE admin_audit_events (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL COLLATE NOCASE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('voting_opened', 'voting_closed')
  ),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX admin_audit_events_created_at_idx
ON admin_audit_events(created_at);
