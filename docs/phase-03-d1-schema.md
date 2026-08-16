# Phase 3: D1 schema conversion

Status: **complete**

This phase translates the authoritative Supabase/Postgres schema in
`supabase/schema.sql` into versioned, SQLite-compatible D1 migrations. It also
adds fixtures and executable constraint checks. No remote D1 database was
created or modified.

## Authoritative source

The conversion was checked statement by statement against
`supabase/schema.sql`, including:

- `families`, `swimmers`, `votes`, `voting_settings`, and `admins`;
- the `swimmer_roster` view;
- `is_admin`, `get_family_ballot`, `cast_vote`, `get_results`,
  `set_voting_open`, and `get_admin_roster` functions;
- RLS declarations and grants; and
- defaults, uniqueness, foreign keys, singleton state, and ordering.

The SQL file was added to the workspace after Phase 1 documented it as absent.
It is now the authoritative source for schema comparisons and supersedes the
earlier frontend-only inference.

## Type and default mapping

| Postgres source | D1 target | Migration rule |
|---|---|---|
| `uuid` | `TEXT` | Preserve exported UUID text; generate new IDs with `crypto.randomUUID()` |
| `timestamptz` | `TEXT` | Preserve/produce ISO 8601 UTC strings |
| `boolean` | `INTEGER` | Store `0` or `1`, enforced with `CHECK` |
| `bigint` count | SQLite `INTEGER` | Return as a safe JSON integer for this dataset |
| `gen_random_uuid()` | no SQL default | Worker supplies IDs explicitly |
| `now()` | no SQL default | Worker supplies timestamps explicitly |

All application tables use SQLite `STRICT` mode to reject incompatible storage
types instead of relying on SQLite's normal type coercion.

## Core table mapping

### `families`

Preserved:

- text ID primary key;
- required, unique email;
- required, unique family token; and
- required creation timestamp.

Postgres email uniqueness is case-sensitive, so the D1 column intentionally
does not add `COLLATE NOCASE`. Changing that behavior would require a separate
data audit and contract decision.

### `swimmers`

Preserved:

- text ID primary key;
- required family relationship;
- required name;
- optional `group_name`; and
- required creation timestamp.

Changed deliberately:

- removed `has_voted` because `votes.voter_id` is the authoritative state;
- added an explicit index on `family_id`; and
- added a case-insensitive name index for roster lookup and ordering.

The family foreign key uses `ON DELETE RESTRICT`, matching the source schema's
non-cascading behavior.

### `votes`

Preserved:

- text ID primary key;
- unique, required voter relationship;
- required candidate relationship; and
- required creation timestamp.

The unique voter constraint remains the database-level concurrency backstop for
one vote per swimmer. An explicit candidate index supports results aggregation.
Both swimmer relationships restrict deletion.

### `voting_settings`

Preserved:

- integer ID constrained to `1`;
- initial `is_open = 1`, matching the Postgres `true` default and seed; and
- nullable `closed_at`.

Added:

- required `updated_at`; and
- nullable `updated_by` for the Access-authenticated admin audit identity.

The migration inserts exactly one initial row. Additional rows and non-boolean
integer values are rejected by checks.

### `admins`

The Supabase table keys admins by `auth.users.id`. Cloudflare Access supplies a
validated email identity instead, so D1 keys this table by case-insensitive
email and records `created_at`.

This is an intentional authentication-provider migration, not a direct column
conversion. Phase 9 must map each Supabase admin UUID through `auth.users.email`
before producing D1 admin inserts. The frontend's public Supabase publishable
key cannot perform that mapping.

## Views

### `swimmer_roster`

Preserves the source `id` and `name` shape and deterministic name ordering.

### `admin_roster`

Materializes the row shape frozen in Phase 1. `has_voted` is derived with an
`EXISTS` query instead of stored on `swimmers`. Ordering preserves the source's
group, family email, and swimmer name sequence with an ID tie-breaker.

### `vote_results`

Preserves the source left join, so candidates with zero votes are included.
Rows sort by vote count descending, then candidate name and ID for deterministic
ties.

`get_family_ballot` remains a parameterized Worker query rather than a view
because it requires a family token. It will be implemented in Phase 4.

## Postgres-only features removed

The D1 migration does not copy:

- `pgcrypto`;
- UUID or timestamp SQL defaults;
- PL/pgSQL and SQL RPC functions;
- `security definer`;
- Supabase `auth.uid()`;
- row-level security declarations; or
- PostgREST role grants.

The Worker becomes the only application database boundary. It owns input
validation, authorization, result shaping, ID/timestamp generation, and route
access. Database constraints continue to enforce relational and vote
correctness.

## Notification schema

`0002_notification_campaigns.sql` adds the Phase 8 persistence model:

- `notification_campaigns` tracks creator, lifecycle status, and mutually
  consistent queued/sent/failed counters;
- `notification_deliveries` tracks one delivery per campaign and family,
  attempts, provider ID, safe failure metadata, and update time;
- a composite primary key on `(campaign_id, family_id)` prevents duplicate
  family sends;
- a partial unique index permits only one `queued` or `sending` campaign at a
  time; and
- delivery foreign keys cascade only when deleting a campaign and restrict
  deleting a referenced family.

Allowed campaign statuses match the frozen API contract. Delivery status adds
`sent` and retains `queued`, `sending`, and `failed` for Queue processing.

## Files changed

### `d1/migrations/0001_initial.sql`

Creates all core tables, constraints, indexes, the singleton voting row, and
three query views.

### `d1/migrations/0002_notification_campaigns.sql`

Creates Queue notification campaign/delivery storage and idempotency indexes.

### `d1/fixtures/test.sql`

Adds deterministic local-only data covering:

- two families;
- three swimmers, including siblings and a nullable group;
- one vote;
- one Access-style admin email; and
- one completed campaign with one delivery per family.

The fixture contains no production names, emails, tokens, or credentials.

### `scripts/test-d1.mjs`

Loads both migrations and the fixture into an in-memory SQLite database with
foreign keys enabled. It checks tables, derived vote state, zero-vote results,
foreign-key integrity, uniqueness, singleton/boolean checks, campaign counters,
delivery idempotency, and the one-active-campaign rule.

### `package.json`

Adds `npm run test:d1` and includes it in `npm run check` before Worker tests.

## Production data transformation contract

Phase 9 must transform exports as follows:

1. Preserve family, swimmer, and vote UUID strings exactly.
2. Preserve every family token exactly so existing links continue working.
3. Convert all timestamps to ISO 8601 UTC text.
4. Convert Postgres booleans to `0` or `1`.
5. Omit `swimmers.has_voted` and verify it equals the existence of a vote for
   that swimmer before import.
6. Import `voting_settings.closed_at`; generate `updated_at` from the export or
   cutover time and leave `updated_by` null for legacy state.
7. Resolve `admins.user_id` through the Supabase Auth export and insert the
   corresponding normalized Access email.
8. Import in parent-first order: families, swimmers, votes, settings, admins.
9. Do not include `BEGIN TRANSACTION`, `COMMIT`, Postgres functions, grants, or
   RLS statements in D1 import SQL.

Cloudflare documents that raw PostgreSQL schemas/dumps are not directly
compatible with D1 and must first be converted to SQLite-compatible SQL:
[D1 import/export guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Verification results

Validated locally on 2026-08-14:

- both migrations execute in SQLite strict mode;
- fixture load succeeds with foreign keys enabled;
- all scripted positive and negative constraint checks pass;
- `PRAGMA foreign_key_check` returns no violations;
- Wrangler applied both migrations to local D1 successfully;
- Wrangler reports no pending local migrations; and
- the local D1 schema contains seven application tables and three views.

No remote database or data was accessed or modified.

## Completion checklist

- [x] Authoritative `supabase/schema.sql` inspected completely.
- [x] Every source table mapped to D1.
- [x] UUID, timestamp, boolean, and count mappings documented.
- [x] `has_voted` duplicate state removed and replaced with a derived value.
- [x] Source uniqueness and foreign-key behavior preserved.
- [x] Voting singleton and initial open state preserved.
- [x] Supabase-only functions, RLS, grants, and auth dependencies removed.
- [x] Access-email admin mapping documented for production migration.
- [x] Core D1 migration created.
- [x] Notification persistence migration created.
- [x] Required indexes created.
- [x] Deterministic non-production fixture created.
- [x] Positive and negative constraint tests pass.
- [x] Both migrations apply successfully with Wrangler local D1.
- [x] Wrangler reports no pending migrations.
- [x] No remote resources were created or modified.

## Exit gate

Passed on 2026-08-14. Phase 4 may implement public ballot, candidate, and atomic
vote routes against the `DB` binding. Phase 9 must still perform row-count,
referential-integrity, token, admin identity, redundant vote-state, and result
total comparisons against the actual production export before cutover.
