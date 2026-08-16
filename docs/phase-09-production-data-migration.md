# Phase 9: Production data migration

Status: **no-data migration confirmed; production cutover pending**

This phase supplies a fail-closed path from the tables defined in
`supabase/schema.sql` to the D1 schema created in Phases 3, 5, and 8. It does not
connect to production automatically. Exporting, importing, switching traffic,
or reopening voting remains an explicit maintenance-window operation.

Cloudflare documents that PostgreSQL dumps are not directly compatible with
D1 and must first be converted to SQLite-compatible SQL. It also requires
transaction statements to be removed from files passed to `wrangler d1 execute`
because Wrangler wraps imports in a transaction:
[D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Data mapping

| Supabase source | D1 target | Transformation |
|---|---|---|
| `families` | `families` | UUIDs remain text; timestamps become UTC ISO strings |
| `swimmers` | `swimmers` | `has_voted` is omitted and derived from `votes` |
| `votes` | `votes` | IDs and references remain text |
| `voting_settings` | singleton row | Boolean becomes `0/1`; migration metadata is added |
| `admins` + `auth.users` | `admins` | User ID is replaced by normalized email |

Notification campaigns, deliveries, campaign keys, and admin audit events are
Cloudflare-only operational data. They start empty and are not sourced from
Supabase.

## Production no-data decision

The application owner confirmed on 2026-08-15 that Supabase contains no
application records to migrate. Therefore no production CSV export,
transformation, preview import rehearsal, or D1 snapshot import is required.
The migration tooling remains in the repository for future auditing and
rollback reference. Production D1 was independently verified empty before its
approved administrator allowlist row was inserted; test fixtures must never be
loaded into production.

## Files changed

### `migration/supabase-export.sql`

Added a read-only `psql` export using client-side `\copy`. It writes five CSV
files with deterministic row ordering. The admin export joins `public.admins`
to `auth.users`, because the old table contains only an Auth user ID while the
D1 allowlist is keyed by email.

### `scripts/transform-supabase-export.mjs`

Added a dependency-free RFC 4180 CSV reader and strict transformer. It:

- requires the expected file and column set;
- validates UUIDs, timestamps, booleans, email addresses, and the settings
  singleton;
- checks unique family IDs, case-insensitive family emails, family tokens,
  swimmer IDs, vote IDs, voter IDs, and admin emails;
- checks every family, voter, and candidate reference;
- rejects any disagreement between source `has_voted` and actual vote rows;
- converts timestamps to UTC ISO strings and booleans to SQLite integers;
- omits redundant `has_voted` state;
- preserves IDs and private family tokens;
- escapes SQL string literals;
- emits inserts in foreign-key-safe order without transaction control; and
- writes a private report containing counts, voting state, and SHA-256 digests
  of the token set and candidate totals, not raw tokens or emails.

The generated import uses ordinary inserts without conflict suppression. A
non-empty or conflicting target therefore fails instead of merging silently.

### `scripts/validate-migration.mjs`

Added an isolated in-memory SQLite validation. It applies all four D1
migrations, imports the generated SQL, and verifies:

- source/target counts for families, swimmers, votes, and admins;
- D1 foreign-key integrity;
- the voting singleton and state;
- family-token uniqueness and token-set digest;
- per-candidate vote-total digest;
- derived voter count and `vote_results` total; and
- empty notification and audit tables.

This validates the exact generated artifact before it is allowed near a remote
database.

### `migration/target-validation.sql`

Added read-only queries for remote post-import checks: row counts, distinct
tokens, derived voters, result totals, orphans, duplicate voters, singleton
settings, and `PRAGMA foreign_key_check`.

### Migration fixtures and tests

Added synthetic `example.com` exports under
`migration/fixtures/supabase-export/`. They cover multiple families, empty
optional values, a comma inside a quoted swimmer name, two votes, a closed
ballot, and an administrator.

`scripts/test-data-migration.mjs` transforms and validates those fixtures in a
temporary directory. It also proves the transformer rejects inconsistent
`has_voted`, an orphan family reference, and a duplicate family token.

`package.json` adds:

- `npm run migration:transform`;
- `npm run migration:validate`; and
- `npm run test:migration`.

The migration test is included in `npm run check`.

### `worker-configuration.d.ts`

Regenerated Wrangler's derived binding and runtime types after the full check
identified that the generated file was stale. No Worker binding configuration
or secret value changed as part of Phase 9.

### Privacy controls

`.gitignore` now excludes `migration/input/`, `migration/output/`, and
`migration/work/`. The scripts set generated SQL and report files to owner-only
permissions where supported and print only aggregate counts.

## Preview rehearsal

Create the private directories and export from Supabase while the application
may still be live:

```sh
mkdir -p migration/input migration/output
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/supabase-export.sql
npm run migration:transform
npm run migration:validate
```

Inspect `migration/output/report.json`. Resolve every transformer failure in
Supabase, then export again; do not edit generated SQL to conceal source drift.

After confirming that the configured preview D1 database is disposable and
empty, apply the schema and import:

```sh
npx wrangler d1 migrations apply nominator-preview --remote --env preview
npx wrangler d1 execute nominator-preview --remote --env preview --file migration/output/import.sql
npx wrangler d1 execute nominator-preview --remote --env preview --file migration/target-validation.sql --json
```

Wrangler supports remote `--file` execution and environment selection as used
above: [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/).
Compare all count metrics with the report. The three orphan metrics and
`duplicate_voters` must be zero, `family_tokens_distinct` must equal `families`,
`derived_voters` and `result_votes` must equal `votes`, and the foreign-key check
must return no rows. Then run the Phase 10 application rehearsal against preview.

## Production maintenance window

Do not reuse the preview export. At the agreed window:

1. Close voting in Supabase and verify it is closed.
2. Take a fresh export into empty `migration/input/`.
3. Run the transformer and isolated validator.
4. Record and review the aggregate report.
5. Confirm production D1 has its migrations but no voting data.
6. Import the newly generated SQL:

   ```sh
   npx wrangler d1 migrations apply nominator-production --remote --env production
   npx wrangler d1 execute nominator-production --remote --env production --file migration/output/import.sql
   npx wrangler d1 execute nominator-production --remote --env production --file migration/target-validation.sql --json
   ```

7. Compare counts and integrity metrics to the report and Supabase.
8. Verify representative existing family links in a controlled smoke test.
9. Verify admin roster, results, and voting state.
10. Deploy/switch the domain only after every acceptance check passes.
11. Reopen voting in D1 only after traffic and smoke tests succeed.
12. Retain Supabase closed and intact for rollback.

Avoid concurrent writes: Supabase and D1 must never both accept votes during
this procedure.

## Rollback boundary

Before D1 accepts a vote, rollback is a traffic switch back to the old frontend
followed by reopening Supabase. After D1 accepts any vote, close both systems,
export and reconcile D1 votes into Supabase using unique `voter_id`, validate
totals, restore traffic, and only then reopen Supabase. Never discard accepted
votes.

## Verification results

Validated locally on 2026-08-14:

- synthetic Supabase CSVs transform successfully;
- generated SQL contains no transaction control;
- all current D1 migrations accept the generated import;
- counts, foreign keys, token digest, vote digest, derived state, and result view
  validate successfully;
- inconsistent derived vote state, orphan references, and duplicate tokens fail
  closed; and
- the migration test is part of the complete project validation command.

No production credentials were read, no parent data was exported, no remote D1
database was created or modified, and no traffic was switched.

## Repository completion checklist

- [x] Read-only Supabase export covers all required source tables.
- [x] Administrator IDs are converted to normalized allowlist emails.
- [x] UUIDs and family tokens are preserved.
- [x] Timestamps become UTC ISO strings.
- [x] Booleans become SQLite `0/1` values.
- [x] Redundant `has_voted` is omitted and consistency-checked.
- [x] Uniqueness and foreign-key relationships are validated before output.
- [x] SQLite SQL is ordered and contains no transaction control.
- [x] Generated artifacts and source exports are ignored by Git.
- [x] Private rows are not written to logs or reports.
- [x] Counts, token set, and vote totals are independently validated.
- [x] Remote read-only validation SQL is provided.
- [x] Synthetic success and fail-closed tests pass.

## External execution checklist

- [ ] Schedule and announce the maintenance window.
- [x] Data-transfer rehearsal is not applicable because the source has no
  application records.
- [x] Complete Phase 10 integration and browser acceptance tests on preview.
- [x] Closing Supabase for export is not applicable because there are no source
  records or active source votes.
- [x] Final export is not applicable; the application owner confirmed the source
  record set is empty.
- [x] Confirm production D1 is the intended empty target.
- [x] Apply all D1 migrations; no snapshot import is required.
- [x] Source and target application aggregates are zero before new Cloudflare
  data is created.
- [x] Existing-family-token validation is not applicable because there are no
  source families.
- [ ] Confirm admin roster/results and the closed state match Supabase.
- [ ] Switch production traffic and perform smoke tests.
- [ ] Reopen voting only in D1.
- [ ] Retain Supabase intact and closed for the rollback window.

## Exit gate

Phase 9 data transfer is complete as an explicitly documented no-op. Production
cutover remains blocked on the deployment window, production smoke tests, and
the remaining Phase 11 approval gates.
