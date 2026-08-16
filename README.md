# Nominator Flare

A Gleam/Lustre single-page application and Cloudflare Worker for a swim team's
"Most Inspirational Swimmer" vote. The Worker serves the compiled frontend,
provides a same-origin JSON API, stores relational data in D1, and protects the
admin dashboard with Cloudflare Access plus a D1 allowlist.

The admin dashboard includes safe family and swimmer management. It generates
UUID IDs and private family tokens, records mutations in the audit trail, and
prevents deletion when swimmers or votes would be orphaned.

The Supabase-to-Cloudflare migration is complete. Preview and production run as
separate Workers with separate D1 databases and Queues. Cloudflare Access is
active for admin routes, and Queue-backed Resend notification delivery has been
verified in production. The original `supabase/` files are retained only as the
schema history and migration reference; Supabase is not used by the running
application.

## Current deployment state

| Environment | Application | State |
|---|---|---|
| Local | `http://localhost:8787` | Wrangler, local D1, and optional test fixtures |
| Preview | `https://preview.projozangu.com` | Deployed and accepted through Phase 12 |
| Production | `https://nominator.projozangu.com` | Deployed; Access, D1, family management, voting, Queues, and Resend delivery verified |

Phase 12 safe family management is complete. Phase 13 is a documented future
redesign for efficiently navigating 40 or more families; its search, filters,
pagination, and collapsed family rows are not implemented yet. See
[`docs/phase-13-scalable-family-management-plan.md`](docs/phase-13-scalable-family-management-plan.md).

## Voting model

- One private token identifies a family.
- A ballot lists every swimmer in that family.
- Each swimmer may nominate any teammate, including themselves.
- Each swimmer can vote once.
- Candidate roster access requires a valid family token.
- Ownership, voting state, candidate validity, and duplicate prevention are
  enforced by the D1-backed Worker API.

## Local setup

Install dependencies and apply the D1 migrations:

```sh
npm install
npm run db:migrate:local
```

Optionally load the deterministic local fixture:

```sh
WRANGLER_WRITE_LOGS=false npx wrangler d1 execute nominator-development \
  --local --file d1/fixtures/test.sql
```

Build the Lustre frontend and run the Worker locally:

```sh
npm run build:frontend
npm run dev
```

The build fingerprints the local JavaScript and CSS assets, rewrites
`index.html`, and emits Cloudflare Static Assets header rules. Do not edit
`dist/` directly; it is generated output.

The public ballot API works locally after loading fixture data. Real admin
requests require a valid Cloudflare Access assertion, so the complete login flow
is tested on preview or production. Automated tests use generated signing keys
and do not require a Cloudflare account.

Run the complete validation suite with:

```sh
npm run check
```

## Data migration history

The Supabase database contained no application records at cutover, so production
data migration was completed as a documented no-op. No preview fixtures were
loaded into production.

The repository retains a read-only Supabase export, strict CSV-to-D1 transformer,
isolated validation pass, and post-import validation queries for auditability or
future recovery work. Generated inputs and outputs remain ignored because they
may contain parent details and private family tokens.

```sh
mkdir -p migration/input migration/output
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/supabase-export.sql
npm run migration:transform
npm run migration:validate
```

Only use this workflow when there is an actual Supabase dataset to transform.
Review `migration/output/report.json`, then follow
[`docs/phase-09-production-data-migration.md`](docs/phase-09-production-data-migration.md).
The transformation scripts do not connect to Supabase or Cloudflare themselves
and never print row contents.

## API

Public routes:

- `GET /api/ballots/:familyToken`
- `GET /api/ballots/:familyToken/candidates`
- `POST /api/ballots/:familyToken/votes`

Access-protected admin routes:

- `GET /api/admin/session`
- `GET /api/admin/roster`
- `GET /api/admin/results`
- `PUT /api/admin/voting`
- `GET /api/admin/families`
- `POST /api/admin/families`
- `PUT /api/admin/families/:familyId`
- `DELETE /api/admin/families/:familyId`
- `POST /api/admin/families/:familyId/swimmers`
- `PUT /api/admin/swimmers/:swimmerId`
- `DELETE /api/admin/swimmers/:swimmerId`
- `POST /api/admin/notifications`
- `GET /api/admin/notifications/:campaignId`

All admin routes require both a cryptographically valid Cloudflare Access
assertion and a matching email in the environment's D1 `admins` allowlist.
Mutation endpoints validate bounded inputs, use Worker-generated UUIDs, and
record audit events. Family and swimmer deletion fails safely when related
records would be orphaned.

## Cloudflare Access

Access is configured for these deployed paths:

```text
preview.projozangu.com/admin*
preview.projozangu.com/api/admin/*
nominator.projozangu.com/admin*
nominator.projozangu.com/api/admin/*
```

The policies are restricted to approved administrator identities. The Worker
validates the Access issuer, audience, signature, and expiry, then checks the D1
allowlist. Both applications use Worker Custom Domains; `workers.dev` and
generated preview URLs are disabled. The frontend stores no JWT and delegates
login to Access. Logout passes through `/api/access/logout` to the Access team
domain.

When adding an administrator, update both the Access policy and the matching
environment's normalized D1 `admins` row.

## Parent notifications

The verified sender is `notifications@projozangu.com`. The Worker creates a D1
campaign and queues one ID-only message per family. The Queue consumer sends
HTML and plain text through Resend, records progress, retries transient
failures, and uses a stable provider idempotency key. Production delivery has
been tested successfully.

The Resend credential is a per-environment Wrangler secret and must never be
placed in `wrangler.jsonc` or committed files. To rotate it:

```sh
npx wrangler secret put RESEND_API_KEY --env preview
npx wrangler secret put RESEND_API_KEY --env production
```

Paste only the secret value at Wrangler's interactive prompt. Do not pass it on
the command line.

`NOTIFICATION_CAMPAIGN_KEY` intentionally permits one campaign per configured
seasonal key. Change it only when intentionally starting a new campaign. A
failed campaign remains recorded and is not silently replayed.

## Deployment and operations

Run the complete local release gate before deploying:

```sh
npm run check
```

Apply pending D1 migrations to the target environment before deploying code
that depends on them. Preview must be deployed and accepted before production:

```sh
npx wrangler d1 migrations list DB --remote --env preview
npx wrangler d1 migrations apply DB --remote --env preview
npx wrangler deploy --env preview

npx wrangler d1 migrations list DB --remote --env production
npx wrangler d1 migrations apply DB --remote --env production
npx wrangler deploy --env production
```

Never load `d1/fixtures/test.sql` into production. Preview and production use
different Workers, D1 databases, Queues, dead-letter Queues, hostnames, secrets,
and Access applications.

## Migration documentation

Each migration phase, its changes, and its verification checklist are recorded
in `docs/`. Earlier phase documents are historical snapshots and may still show
the external setup that was pending when that phase was implemented. The current
operational state is summarized here and in the later deployment documents.

## Known product decisions

- Split households currently map each swimmer to one family.
- Lost links are recovered by an administrator; there is no public lookup.
- Results sort by vote count and do not apply a tie-break policy.
- Notification campaigns are intentionally one-per configured seasonal key;
  change the key before starting a new season.
- The current family-management screen renders all family cards. The planned
  Phase 13 redesign will add search, filtering, pagination, and collapsed detail
  rows before the dataset grows substantially beyond 40 families.
