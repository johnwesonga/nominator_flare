import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");

for (const migration of [
  "d1/migrations/0001_initial.sql",
  "d1/migrations/0002_notification_campaigns.sql",
  "d1/migrations/0003_admin_audit_events.sql",
  "d1/migrations/0004_notification_campaign_keys.sql",
  "d1/fixtures/test.sql",
]) {
  database.exec(readFileSync(migration, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectConstraint(name, statement) {
  try {
    database.exec(statement);
  } catch {
    return;
  }
  throw new Error(`Expected constraint failure: ${name}`);
}

const tables = database
  .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
  .all()
  .map(({ name }) => name);

for (const expected of [
  "admins",
  "admin_audit_events",
  "families",
  "notification_campaigns",
  "notification_campaign_keys",
  "notification_deliveries",
  "swimmers",
  "votes",
  "voting_settings",
]) {
  assert(tables.includes(expected), `Missing table: ${expected}`);
}

const swimmerColumns = database
  .prepare("PRAGMA table_info(swimmers)")
  .all()
  .map(({ name }) => name);
assert(!swimmerColumns.includes("has_voted"), "has_voted must be derived");

const roster = database
  .prepare("SELECT swimmer_id, has_voted FROM admin_roster ORDER BY swimmer_id")
  .all();
assert(roster.length === 3, "Admin roster must include every swimmer");
assert(roster[0]?.has_voted === 1, "Recorded voter must derive has_voted = 1");
assert(roster[1]?.has_voted === 0, "Non-voter must derive has_voted = 0");

const results = database
  .prepare("SELECT candidate_id, vote_count FROM vote_results ORDER BY candidate_id")
  .all();
assert(results.length === 3, "Results must include zero-vote candidates");
assert(
  results.find(
    ({ candidate_id }) =>
      candidate_id === "20000000-0000-4000-8000-000000000003",
  )?.vote_count === 1,
  "Candidate vote count must match fixture",
);
assert(
  database.prepare("PRAGMA foreign_key_check").all().length === 0,
  "Fixture must have no foreign-key violations",
);

expectConstraint(
  "family email uniqueness",
  "INSERT INTO families VALUES ('family-x', 'parent.one@example.com', 'token-x', '2026-08-14T00:00:00.000Z')",
);
expectConstraint(
  "family token uniqueness",
  "INSERT INTO families VALUES ('family-x', 'other@example.com', '10000000-0000-4000-8000-000000000001', '2026-08-14T00:00:00.000Z')",
);
expectConstraint(
  "orphan swimmer foreign key",
  "INSERT INTO swimmers VALUES ('swimmer-x', 'missing-family', 'Missing', NULL, '2026-08-14T00:00:00.000Z')",
);
expectConstraint(
  "one vote per voter",
  "INSERT INTO votes VALUES ('vote-x', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '2026-08-14T00:00:00.000Z')",
);
expectConstraint(
  "invalid voting boolean",
  "UPDATE voting_settings SET is_open = 2 WHERE id = 1",
);
expectConstraint(
  "voting settings singleton",
  "INSERT INTO voting_settings VALUES (2, 0, NULL, '2026-08-14T00:00:00.000Z', NULL)",
);
expectConstraint(
  "one delivery per campaign and family",
  "INSERT INTO notification_deliveries VALUES ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'sent', NULL, 1, NULL, '2026-08-14T00:00:00.000Z')",
);
expectConstraint(
  "campaign counters equal total",
  "INSERT INTO notification_campaigns VALUES ('campaign-x', 'manager@example.com', '2026-08-14T00:00:00.000Z', 'completed', 2, 0, 1, 0)",
);

database.exec(
  "INSERT INTO notification_campaigns VALUES ('campaign-active', 'manager@example.com', '2026-08-14T00:00:00.000Z', 'queued', 0, 0, 0, 0)",
);
expectConstraint(
  "only one active notification campaign",
  "INSERT INTO notification_campaigns VALUES ('campaign-active-2', 'manager@example.com', '2026-08-14T00:00:00.000Z', 'sending', 0, 0, 0, 0)",
);
expectConstraint(
  "known admin audit event type",
  "INSERT INTO admin_audit_events VALUES ('audit-x', 'manager@example.com', 'unknown', '2026-08-14T00:00:00.000Z')",
);
database.exec(
  "INSERT INTO notification_campaign_keys VALUES ('2026-most-inspirational', '40000000-0000-4000-8000-000000000001')",
);
expectConstraint(
  "one campaign per configured campaign key",
  "INSERT INTO notification_campaign_keys VALUES ('2026-most-inspirational', 'campaign-active')",
);

database.close();
console.log("D1 schema checks passed");
