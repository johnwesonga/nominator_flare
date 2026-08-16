# Phase 10: Testing

Status: **complete**

This phase consolidates the test coverage built during Phases 3–9, closes the
remaining lifecycle and frontend-state gaps, and makes one command enforce the
whole local release gate. Tests use synthetic `example.com` identities and
local D1 state. They do not send email or access remote Cloudflare resources.

Cloudflare recommends testing Workers in the Workers runtime rather than only
in a Node emulation. The Worker suite uses the Cloudflare Vitest integration,
real D1 migrations, isolated storage, Queue test events, and generated Access
signing keys: [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/).

## Test layers

| Layer | Command | Coverage |
|---|---|---|
| Gleam state/decoders | `gleam test` | API shapes, Access dashboard state, ballot restoration, notification state |
| Worker runtime | `npm test` | routing, D1 APIs, Access JWTs, concurrent voting, campaigns, Queue/Resend behavior |
| D1 schema | `npm run test:d1` | migrations, views, constraints, derived vote state |
| Data migration | `npm run test:migration` | Supabase transform, import, counts, integrity, fail-closed cases |
| Static package | `npm run test:static` | fingerprinting, references, cache and SPA header rules |
| Type/config | `npm run types:check`, `npm run typecheck` | Wrangler bindings and strict TypeScript |
| Deploy package | `npm run deploy:dry-run` | Worker bundle, assets, bindings, secrets declaration |

`npm run check` now runs every row above, including Gleam formatting and tests.
The GitHub Actions workflow already invokes this command on pushes and pull
requests.

## Files changed

### `worker/test/public-api.test.ts`

Added a cross-step ballot lifecycle test that:

1. casts votes for both swimmers in a family;
2. reloads the ballot and verifies recorded candidate names;
3. confirms the duplicate vote result;
4. closes voting;
5. confirms another family is rejected immediately; and
6. validates the final non-zero result totals.

The existing public suite also covers invalid and unknown family tokens,
token-protected candidate roster access, ownership, invalid candidates,
self-nomination, malformed/oversized bodies, and two simultaneous votes for one
voter. The concurrency test proves exactly one insert succeeds.

### `worker/test/notifications.test.ts`

Added malformed campaign-ID coverage. The existing suite covers seasonal
campaign idempotency, one delivery per family, progress lookup, HTML escaping,
plain text, provider idempotency, duplicate suppression, transient retries,
permanent failure, and the terminal dead-letter path.

### `test/nominator_flare_test.gleam`

Added decoder coverage for:

- family ballot rows including an optional recorded candidate;
- token-scoped candidate roster rows;
- admin roster rows including nullable groups;
- result rows and vote counts.

Added frontend state coverage for an invalid family link, restoring a recorded
vote after reload, and a visible campaign-poll failure. Existing tests cover
Access session initialization/failure and notification completion.

### `package.json`

Expanded `npm run check` to run `gleam format --check src test` and `gleam test`
inside the same authoritative local gate as the frontend build, static checks,
generated Worker types, TypeScript, D1, migration tests, Worker tests, and
deployment dry-run.

### `README.md`

Advanced repository status through Phase 10 and made the distinction between
completed local automation and pending preview/production acceptance explicit.

## Automated matrix

### Worker and database behavior

- [x] Valid, malformed, and unknown family tokens.
- [x] Recorded candidate name appears after voting.
- [x] Candidate roster requires a valid family token.
- [x] Voting open and closed behavior.
- [x] Invalid candidate.
- [x] Swimmer not owned by the family.
- [x] Sequential duplicate vote.
- [x] Simultaneous duplicate votes result in one insert.
- [x] Self-nomination remains allowed.
- [x] Missing Access assertion.
- [x] Wrong audience, expiry, signature, and missing email claim.
- [x] Valid identity missing from the D1 allowlist.
- [x] Normalized allowlisted administrator.
- [x] Admin roster, results, voting writes, and audit events.
- [x] Notification campaign and delivery idempotency.
- [x] Malformed and unknown campaign IDs.
- [x] Email HTML escaping and plain-text URL.
- [x] Queue success, duplicate suppression, retry, permanent failure, and DLQ path.

### Gleam behavior

- [x] Public and admin response decoder contracts.
- [x] Access-authenticated dashboard initialization.
- [x] Failed Access session is visible.
- [x] Invalid ballot link is visible.
- [x] Recorded votes restore correctly after reload.
- [x] Notification progress completion and failure state.
- [x] Same-origin no-JWT transport is used by application code.
- [x] Candidate roster request accepts the family token.

### Integration and packaging

- [x] Fixture family with multiple swimmers.
- [x] Candidate roster load.
- [x] Vote once for each child and reload recorded choices.
- [x] Duplicate vote rejection.
- [x] Immediate close enforcement.
- [x] Final result totals.
- [x] Fake provider adapter path with one delivery per family.
- [x] Direct `/admin` and `/vote/:token` SPA fallback package rules.
- [x] Hashed asset and cache policy validation.
- [x] SQLite-compatible production migration rehearsal.
- [x] Wrangler deployment dry-run.

### Preview fixture correction

The original `d1/fixtures/test.sql` used human-readable identifiers such as
`family-token-1`. The public API intentionally rejects those because production
family tokens are UUIDs. The fixture now uses synthetic UUIDs for families,
tokens, swimmers, votes, and campaigns. It removes only the exact legacy fake
records before loading and uses `INSERT OR IGNORE`, making repeated local or
preview loads safe while preserving a real administrator allowlist row. The
fixture remains explicitly forbidden in production.

## Preview browser acceptance

The real Access redirect cannot be completed on plain localhost. After the
Phase 5 external setup and a preview deployment to a Cloudflare-managed
hostname, manually verify:

- [x] Direct navigation and refresh on a real `/vote/:familyToken`.
- [x] Direct `/admin` navigation redirects to Access.
- [x] Allowed manager authentication returns to `/admin`.
- [x] A denied identity cannot load `/admin` or `/api/admin/session`.
- [x] The allowlisted manager can load roster and results.
- [x] Access logout and return-to-login behavior.
- [x] Expired/revoked Access session behavior.
- [x] Voting on a mobile viewport.
- [x] Voting open/close is enforced between the deployed admin and ballot flows.
- [x] Candidate search and selection using Tab and Enter/Space.
- [x] Candidate search and selection using touch.
- [x] Useful UI messages and recovery during deliberate API failures.
- [x] Controlled-address notification delivery and progress polling.
- [x] Browser console contains no token, JWT, credential, or unhandled error.

Record the preview deployment version, hostname, test family ID (never its
token), administrator identity, date, and pass/fail evidence before approving
production. Do not place family tokens or Access assertions in screenshots or
logs.

Acceptance results confirmed by the application owner on 2026-08-15:

- the ballot renders correctly on a mobile viewport; and
- opening and closing voting from the admin dashboard is enforced by the ballot
  API.

Keyboard acceptance initially failed because autocomplete candidates were
rendered as click-only `div` elements. They are now native `button` elements,
which enter the tab order and support selection with Enter or Space. Their CSS
resets browser button defaults while retaining a visible `:focus-visible`
outline. The application owner confirmed the deployed preview keyboard retest
passed on 2026-08-15. The application owner also confirmed candidate search and
selection using touch passed on the deployed preview that day.

The application owner additionally confirmed on 2026-08-15 that:

- an identity denied by the preview Access policy cannot load the admin UI or
  admin session API; and
- an expired or revoked Access session no longer permits admin actions and
  follows the expected reauthentication flow.

Deliberate offline testing was also confirmed on 2026-08-15. Admin refresh,
ballot submission, and notification requests each displayed a useful failure
message, left the interface usable, and recovered after browser connectivity
was restored.

The application owner confirmed all remaining preview acceptance checks passed
on 2026-08-15, including direct ballot navigation and refresh, the complete
Access login/logout flow, allowlisted roster and result loading, controlled
notification delivery with campaign progress polling, and a clean browser
console without exposed credentials or unhandled errors.

## Verification results

Latest full release-gate validation completed on 2026-08-15:

- all 15 Gleam tests pass;
- all 42 Worker runtime tests pass across four files;
- the new end-to-end ballot lifecycle passes;
- D1 schema and production migration checks pass;
- static frontend packaging checks pass;
- strict TypeScript and generated Wrangler type checks pass; and
- the Worker deployment dry-run passes.

The automated suite does not access remote services or real recipients. Preview
acceptance separately exercised the deployed Worker, D1 database, Access
application, Queue, custom domain, and controlled email recipients. No
production data or production recipient was modified.

## Completion checklist

- [x] Worker unit and runtime matrix is implemented.
- [x] Gleam decoder and state matrix is implemented.
- [x] Cross-step ballot integration lifecycle is implemented.
- [x] Queue uses a fake provider response in tests.
- [x] D1 migration and production-data rehearsal are automated.
- [x] Static SPA route/package validation is automated.
- [x] One local command enforces formatting, tests, types, schema, build, and dry-run.
- [x] CI invokes the complete validation command.
- [x] Local automated suite passes.
- [x] Automated tests remain isolated from external services and recipients.
- [x] Preview Access/browser acceptance is complete.
- [x] Controlled-address notification acceptance is complete.

## Exit gate

Phase 10 is complete. Local automation, preview Access/browser acceptance, and
controlled-email acceptance all pass. Production migration and deployment may
proceed through the Phase 9 and Phase 11 production gates.
