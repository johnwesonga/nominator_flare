-- Extend the admin audit-event vocabulary for family and swimmer management.

CREATE TABLE admin_audit_events_new (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL COLLATE NOCASE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'voting_opened',
      'voting_closed',
      'family_created',
      'family_updated',
      'family_deleted',
      'swimmer_created',
      'swimmer_updated',
      'swimmer_deleted'
    )
  ),
  target_type TEXT CHECK (target_type IN ('family', 'swimmer')),
  target_id TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT admin_audit_target_pair CHECK (
    (target_type IS NULL AND target_id IS NULL)
    OR (target_type IS NOT NULL AND target_id IS NOT NULL)
  )
) STRICT;

INSERT INTO admin_audit_events_new (id, actor_email, event_type, created_at)
SELECT id, actor_email, event_type, created_at
FROM admin_audit_events;

DROP TABLE admin_audit_events;
ALTER TABLE admin_audit_events_new RENAME TO admin_audit_events;

CREATE INDEX admin_audit_events_created_at_idx
ON admin_audit_events(created_at);

CREATE UNIQUE INDEX families_email_nocase_unique
ON families(email COLLATE NOCASE);
