import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function assert(condition, message) {
  if (!condition) throw new Error(`Migration validation failed: ${message}`);
}

function digest(values) {
  return createHash("sha256").update([...values].sort().join("\n"), "utf8").digest("hex");
}

export function validateMigration({ importFile, reportFile }) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  assert(report.formatVersion === 1, "unsupported report format");
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    for (const migration of ["0001_initial.sql", "0002_notification_campaigns.sql", "0003_admin_audit_events.sql", "0004_notification_campaign_keys.sql"]) {
      database.exec(readFileSync(join(root, "d1/migrations", migration), "utf8"));
    }
    const source = readFileSync(importFile, "utf8");
    assert(!/\b(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(source.replace(/^--.*$/gm, "")), "import SQL must not contain transaction control");
    database.exec(source);
    database.exec("PRAGMA foreign_key_check");
    assert(database.prepare("PRAGMA foreign_key_check").all().length === 0, "foreign-key violations found");
    for (const table of ["families", "swimmers", "votes", "admins"]) {
      const count = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
      assert(count === report.counts[table], `${table} count expected ${report.counts[table]}, got ${count}`);
    }
    const setting = database.prepare("SELECT id, is_open, closed_at FROM voting_settings").get();
    assert(setting?.id === 1, "voting settings singleton is missing");
    assert(Boolean(setting.is_open) === report.voting.isOpen, "voting state differs");
    assert(setting.closed_at === report.voting.closedAt, "voting closed_at differs");
    const tokens = database.prepare("SELECT family_token FROM families ORDER BY family_token").all().map(({ family_token }) => family_token);
    assert(new Set(tokens).size === tokens.length, "family tokens are not unique");
    assert(digest(tokens) === report.digests.familyTokensSha256, "family token set differs");
    const results = database.prepare("SELECT candidate_id, COUNT(*) AS count FROM votes GROUP BY candidate_id ORDER BY candidate_id").all();
    assert(digest(results.map(({ candidate_id, count }) => `${candidate_id}:${count}`)) === report.digests.voteResultsSha256, "vote totals differ");
    const derivedVoters = database.prepare("SELECT COUNT(*) AS count FROM swimmers s WHERE EXISTS (SELECT 1 FROM votes v WHERE v.voter_id = s.id)").get().count;
    assert(derivedVoters === report.counts.votes, "derived voter count differs from vote count");
    const viewTotal = database.prepare("SELECT COALESCE(SUM(vote_count), 0) AS count FROM vote_results").get().count;
    assert(viewTotal === report.counts.votes, "vote_results total differs from vote count");
    for (const table of ["notification_campaigns", "notification_deliveries", "admin_audit_events"]) {
      assert(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count === 0, `${table} must be empty after source migration`);
    }
    return report;
  } finally {
    database.close();
  }
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const importFile = resolve(argument("--input", join(root, "migration/output/import.sql")));
  const reportFile = resolve(argument("--report", join(root, "migration/output/report.json")));
  const report = validateMigration({ importFile, reportFile });
  console.log(`Migration validation passed: ${report.counts.families} families, ${report.counts.swimmers} swimmers, ${report.counts.votes} votes, ${report.counts.admins} admins`);
}
