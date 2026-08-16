# Phase 5: Cloudflare Access and admin API

Status: **repository implementation complete; Cloudflare dashboard setup pending**

This phase replaces the Worker admin boundary with Cloudflare Access JWT
validation and a D1 administrator allowlist. It also implements the session,
roster, results, and voting-state routes defined in the frozen API contract.

The frontend still contains the Supabase login flow. Removing that UI and its
JWT transport is Phase 6 work and is intentionally outside this phase.

## Implemented routes

| Method | Route | Result |
|---|---|---|
| `GET` | `/api/admin/session` | Authenticated administrator email |
| `GET` | `/api/admin/roster` | Administrative family/swimmer roster |
| `GET` | `/api/admin/results` | Candidate vote totals |
| `PUT` | `/api/admin/voting` | Opens or closes voting |

The notification routes remain placeholders until Phase 8, but they pass
through the same authorization boundary now. Every defined `/api/admin/*`
route rejects unauthenticated requests before its handler runs.

## Authentication and authorization flow

For each defined admin request, `worker/src/auth.ts`:

1. reads `Cf-Access-Jwt-Assertion`;
2. loads the signing keys from the configured Access team domain;
3. cryptographically validates the RS256 signature, issuer, audience, and
   expiration with `jose`;
4. requires a non-empty email claim;
5. trims and lowercases the email; and
6. requires the normalized email in the D1 `admins` table.

Missing or invalid assertions return the stable `401 unauthorized` envelope.
A valid Access identity absent from the allowlist returns `403 forbidden`.
Database failures are not disguised as authentication failures; they reach the
existing generic `500` boundary.

The Worker does not trust the presence of the header alone. This follows
Cloudflare's documented requirement to validate Access JWTs:
[Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Files changed

### `worker/src/auth.ts`

Added the shared Access authorization boundary. The configured team domain must
be HTTPS, the Access audience must be non-empty, and the checked-in placeholder
values are explicitly rejected. This makes an incompletely configured remote
deployment fail closed.

The remote JWK set is created within the request invocation. No request-scoped
Cloudflare object or mutable authentication state is retained globally.

### `worker/src/router.ts`

The router centrally authorizes all defined admin and admin-notification routes
before dispatch. Successful requests pass a typed `AdminIdentity` to the admin
handler. Public routes remain anonymous.

### `worker/src/routes/admin.ts`

Implemented:

- session lookup returning `{ "email": "..." }`;
- roster reads from the D1 `admin_roster` view, converting integer vote state
  to a JSON boolean;
- result reads from the D1 `vote_results` view; and
- bounded `PUT` JSON parsing for `{ "open": boolean }`.

Voting settings and their audit event are written in one D1 batch. Closing sets
`closed_at`; reopening clears it. Both operations set `updated_at` and
`updated_by` to the authenticated administrator.

All successful API responses are non-cacheable. The voting write returns
`204 No Content`.

### `worker/src/responses.ts`

Added stable `unauthorized` and `forbidden` error codes.

### `d1/migrations/0003_admin_audit_events.sql`

Added the strict `admin_audit_events` table with:

- a Worker-generated UUID;
- normalized actor email;
- constrained `voting_opened` or `voting_closed` event types; and
- an ISO timestamp.

An index supports reverse-chronological audit review. The audit table contains
no Access assertion or family token.

### `wrangler.jsonc`

Added environment-specific `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` variables.
The checked-in values are safe placeholders and must be replaced before a
remote deployment.

Also disabled `workers.dev` and preview URLs so production cannot bypass the
Access-protected custom hostname. A real custom domain or route must therefore
be configured before remote use. Cloudflare documents this Wrangler control at
[Disable `workers.dev`](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

### `package.json` and `package-lock.json`

Added `jose` as a runtime dependency for standards-compliant JWT and remote JWK
validation.

### `vitest.config.ts`

Added test-only Access audience and team-domain bindings. These do not replace
the per-environment remote values in Wrangler.

### `worker/test/admin-api.test.ts`

Added Worker-runtime integration tests with generated RSA keys, a mocked Access
JWK endpoint, and real local D1 migrations. Coverage includes:

- missing assertion;
- wrong audience;
- expired token;
- invalid signature;
- missing email claim;
- valid but non-allowlisted identity;
- normalized allowlisted session;
- roster and results response shapes;
- voting close and reopen writes;
- audit events for both voting changes;
- invalid voting JSON; and
- authorization of notification placeholders.

### Other tests and scripts

`worker/test/router.test.ts` now expects unauthenticated admin routes to return
`401`. `scripts/test-d1.mjs` applies and validates the third migration,
including the audit event constraint.

## Local development

The automated tests generate their own Access signing key and JWK response, so
they run without a Cloudflare account or a real Access token:

```sh
npm test
```

Normal `wrangler dev` requests to admin endpoints require a genuine assertion
matching the configured team domain and audience. Local public endpoints remain
usable without Access. The frontend cannot complete the new Access flow until
Phase 6 removes its Supabase-specific authentication code.

## Verification results

Validated locally on 2026-08-14:

- strict TypeScript checking passes;
- D1 schema checks pass with all three migrations;
- migration `0003_admin_audit_events.sql` is applied to the local Wrangler D1
  database;
- three Worker test files pass; and
- all 32 Worker tests pass in the Cloudflare Workers runtime.

No remote Cloudflare resource, Access policy, D1 database, or DNS route was
created or modified.

## Repository completion checklist

- [x] Access assertion header is required for every defined admin route.
- [x] JWT signature, RS256 algorithm, issuer, audience, and expiry are checked.
- [x] Email claim is required and normalized.
- [x] D1 `admins` allowlist is enforced.
- [x] Invalid authentication returns `401` without leaking validation details.
- [x] Non-allowlisted identities return `403`.
- [x] Admin session route is implemented.
- [x] Admin roster route is implemented with the frozen row shape.
- [x] Admin results route is implemented with the frozen row shape.
- [x] Voting open/close route validates bounded JSON.
- [x] Voting changes and audit events are atomic.
- [x] Administrator email is recorded for voting changes.
- [x] Notification placeholders share the admin authorization boundary.
- [x] Checked-in Access placeholders fail closed.
- [x] `workers.dev` and preview URLs are disabled.
- [x] Worker, TypeScript, and D1 tests pass.
- [x] No remote resources were modified.

## Required Cloudflare setup before deployment

- [ ] Create one self-hosted Access application covering `/admin*` and
  `/api/admin/*`, or ensure both applications use the configured audiences.
- [ ] Restrict its Allow policy to the manager email or identity-provider group.
- [ ] Replace `ACCESS_TEAM_DOMAIN` in every Wrangler environment.
- [ ] Replace `ACCESS_AUD` in every Wrangler environment with the application's
  audience tag.
- [ ] Configure an Access-protected custom domain or Worker route.
- [ ] Insert the normalized manager email into each environment's D1 `admins`
  table.
- [ ] Apply migration `0003_admin_audit_events.sql` to preview and production.
- [ ] Verify unauthorized, authorized, and non-allowlisted behavior remotely.
- [ ] Confirm no alternate hostname can reach `/api/admin/*` without Access.

Cloudflare Access supports path-specific application policies:
[Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).

## Exit gate

The repository portion of Phase 5 is complete. The external checklist is a
deployment prerequisite because this project does not contain the account,
zone, hostname, identity provider, or administrator email needed to create the
real Access application safely.

Phase 6 may now replace the Gleam Supabase transport and custom login UI with
same-origin Worker requests and Access-managed navigation.
