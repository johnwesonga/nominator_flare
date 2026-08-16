# Phase 6: Same-origin frontend transport

Status: **complete**

This phase removes the Supabase-specific browser transport and custom
email/password authentication state. The Lustre SPA now calls the Worker JSON
API through relative, same-origin `/api/*` paths. Cloudflare Access owns admin
authentication, while the Worker continues to validate the Access assertion and
D1 administrator allowlist from Phase 5.

## Endpoint migration

| Frontend operation | Old Supabase request | New Worker request |
|---|---|---|
| Family ballot | `POST /rest/v1/rpc/get_family_ballot` | `GET /api/ballots/:token` |
| Candidate roster | Public `GET /rest/v1/swimmer_roster` | `GET /api/ballots/:token/candidates` |
| Cast vote | `POST /rest/v1/rpc/cast_vote` | `POST /api/ballots/:token/votes` |
| Admin session | `POST /auth/v1/token` | `GET /api/admin/session` |
| Admin roster | `POST /rest/v1/rpc/get_admin_roster` | `GET /api/admin/roster` |
| Admin results | `POST /rest/v1/rpc/get_results` | `GET /api/admin/results` |
| Voting state | `POST /rest/v1/rpc/set_voting_open` | `PUT /api/admin/voting` |
| Parent notifications | Supabase Edge Function | `POST /api/admin/notifications` |

The notification route remains a Worker placeholder until Phase 8. The frontend
now targets its final same-origin route, so Phase 8 will not need another
provider transport change.

## Files changed

### `src/http_client.gleam`

Added a provider-neutral transport module with:

- `get_json`;
- `post_json`;
- `post_expect_ok`; and
- `put_expect_ok`.

It uses RSVP's relative-URL browser support. Requests contain only the JSON
content type required for writes. There is no hard-coded origin, API key,
`Authorization` header, or application-managed JWT. Because the URLs are
relative, the browser sends the Cloudflare Access cookie according to its normal
same-origin cookie rules.

### `src/supabase.gleam`

Deleted. This removes the hard-coded Supabase URL and publishable key, Supabase
`apikey` header, bearer headers, and authenticated request variants from the
compiled frontend.

The original server-side Supabase folder remains unchanged as a data-migration
and rollback source.

### `src/api.gleam`

Repointed every frontend operation to the frozen Worker contract while retaining
the established ballot, roster, result, and vote-result decoders.

Additional contract changes:

- family tokens are percent-encoded before entering URL paths;
- candidate roster requests now receive the family token;
- vote JSON now sends `voter_swimmer_id` and `candidate_id`;
- the Supabase password-login function and access-token decoder were removed;
- `AdminSession(email)` and its decoder were added;
- admin functions no longer accept a JWT; and
- voting changes use `PUT` rather than the old RPC `POST`.

### `src/family.gleam`

Passes the family token to both initial requests: ballot state and candidate
roster. The candidate list is no longer anonymously retrievable without a valid
family token.

### `src/admin.gleam`

Removed:

- email and password input state;
- the custom login form;
- login submission messages;
- JWT storage and propagation; and
- application-only logout state.

The new state flow is:

```text
Inactive
  → LoadingSession
  → LoadingDashboard(email)
  → LoggedIn(email, roster, results, ...)

Any initial session/dashboard failure
  → SessionFailed
  → RetrySession
```

Entering the admin route calls `/api/admin/session`. Once the Worker confirms
the Access identity and allowlist, the SPA loads roster and results without
auth headers. The authenticated email is displayed in the dashboard header.

The sign-out control is a real navigation link to `/api/access/logout`. The
Worker redirects that request to Cloudflare's documented team-domain logout
path:
[Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).

The indirection is necessary because `/cdn-cgi/*` is reserved by Cloudflare and
cannot be reliably overridden by Worker routing. `/api/access/logout` is run
through the Worker first and returns a `302` to the configured
`ACCESS_TEAM_DOMAIN`. This clears the global Access session without hard-coding
a preview or production team domain in the compiled frontend.

The control dispatches an application `Logout` message and uses `modem.load` to
perform a full document navigation. A normal same-origin anchor cannot be used
here because Modem intercepts internal links for client-side routing; that would
render the SPA's not-found view until the browser was manually refreshed.

### `src/app.gleam`

Admin session initialization now occurs only when `/admin` is active. Public
home and ballot routes do not make background admin calls. Navigating into
`/admin` initializes a fresh Access session check.

User-facing transport errors now refer to the application server instead of
Supabase.

### `src/types.gleam`

Removed the unused legacy `AdminState` type that still modeled a Supabase JWT
and password login.

### `test/nominator_flare_test.gleam`

Added Gleam coverage for:

- valid admin-session decoding;
- rejection of a missing session email;
- inactive admin initialization on public routes;
- transition from a valid Access session to dashboard loading; and
- visible failure state after session transport failure.

The Gleam suite now has six passing tests.

### `README.md`

Replaced the Supabase setup instructions with the current Worker, D1, Access,
same-origin API, local-development, and migration status documentation.

### `package.json`

Added `npm run db:migrate:local`, the documented non-remote command for applying
versioned migrations to the Wrangler development database.

## Security and privacy properties

- No Supabase hostname or browser credential remains under `src/`.
- No API key, bearer header, JWT, email password, or token storage exists in the
  Gleam frontend.
- Family tokens are transmitted only in the same-origin API path required by the
  contract.
- Candidate roster access carries the family token.
- Admin authorization remains server-enforced; the client session state is not
  trusted by the Worker.
- Public routes do not probe the protected admin session endpoint.
- Access logout performs a full browser navigation rather than only clearing SPA
  state.
- The production frontend bundle was scanned for the removed Supabase hostname,
  publishable-key prefix, PostgREST/Auth paths, `apikey`, and bearer header.

Cloudflare documents relative SPA API requests with Worker-first `/api/*`
routing as a supported Static Assets pattern:
[Static Assets SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

## Verification results

Validated locally on 2026-08-14:

- Gleam formatting passes;
- Gleam compilation passes;
- all six Gleam tests pass;
- the production Lustre bundle builds successfully;
- TypeScript and D1 schema validation pass;
- all 32 Worker tests pass;
- the Wrangler deployment dry run passes; and
- no removed Supabase frontend URL, key prefix, API path, or auth header appears
  in `src/` or the built frontend assets.

No remote Cloudflare or Supabase resource was accessed or modified.

## Completion checklist

- [x] Provider-neutral HTTP client added.
- [x] Supabase browser transport deleted.
- [x] Hard-coded Supabase URL and publishable key removed from frontend source.
- [x] `apikey` and bearer headers removed.
- [x] Public requests use relative Worker API paths.
- [x] Family ballot uses `GET /api/ballots/:token`.
- [x] Candidate roster receives and sends the family token.
- [x] Vote request uses the frozen Worker JSON field names.
- [x] Admin session initializes through `/api/admin/session`.
- [x] Supabase password login UI and state removed.
- [x] JWT storage and propagation removed.
- [x] Admin roster, results, and voting calls use the Worker API.
- [x] Access logout link added.
- [x] Admin checks run only on the admin route.
- [x] Legacy provider language removed from runtime errors.
- [x] Decoder and admin initialization tests added.
- [x] README updated to the current architecture.
- [x] Documented local D1 migration command added.
- [x] Built frontend scanned for removed Supabase values.
- [x] Complete local verification passes.
- [x] No remote resources were modified.

## External verification before deployment

- [ ] Complete the Phase 5 Cloudflare Access account checklist.
- [ ] Verify direct navigation to `/admin` redirects through Access and returns
  to the dashboard.
- [ ] Verify the displayed session email is the expected allowlisted identity.
- [ ] Verify sign-out clears the Access application session.
- [ ] Verify an expired Access session is redirected or produces the visible
  retry state without exposing admin data.
- [ ] Verify direct navigation and refresh on `/vote/:familyToken`.

## Exit gate

Phase 6 is complete in the repository. Phase 7 may focus on final static-asset
packaging, route refresh behavior, caching policy, and browser-level deployment
verification. Account-backed Access behavior remains an explicit deployment
check rather than being simulated as complete.
