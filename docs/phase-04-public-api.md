# Phase 4: Public ballot and voting API

Status: **complete**

This phase replaces the three public Supabase/PostgREST calls with
contract-compatible Worker routes backed by D1. It implements family ballot
lookup, token-gated candidate roster access, and atomic vote insertion. Admin
routes remain `501 Not Implemented` until Phase 5.

## Implemented routes

| Method | Route | Status |
|---|---|---|
| `GET` | `/api/ballots/:familyToken` | Implemented |
| `GET` | `/api/ballots/:familyToken/candidates` | Implemented |
| `POST` | `/api/ballots/:familyToken/votes` | Implemented |

The response bodies and business result strings match the frozen contract in
`docs/phase-01-api-contract.md`.

## Files changed

### `worker/src/index.ts`

The fetch handler now passes the generated `Env` object into the router. D1 is
accessed through `env.DB`; no REST call or manually maintained binding interface
is used.

The existing top-level error boundary remains responsible for converting
unexpected database/runtime failures to the standard `500` envelope. It logs
only the error class and a fixed event name—never the request URL, family token,
request body, swimmer ID, or candidate ID.

### `worker/src/router.ts`

Route handlers now receive `Env`. Public handlers use `env.DB`; admin and
notification placeholders remain compatible while ignoring the unused binding.

Method mismatch and unknown-route behavior is unchanged.

### `worker/src/responses.ts`

Added:

- the stable `invalid_request` error code; and
- `jsonResponse`, which returns application JSON with `Cache-Control: no-store`.

All ballot, roster, vote, and error responses are non-cacheable.

### `worker/src/request.ts`

Added shared public-request validation:

- validates UUID path/body values using the source schema's UUID shape;
- safely decodes URL path segments;
- requires `Content-Type: application/json` for vote writes;
- streams and bounds JSON request bodies to 4 KiB before parsing; and
- returns the standard `400 invalid_request` envelope for invalid input.

The bounded stream prevents an untrusted request from being buffered without a
limit. Extra JSON fields are ignored, as allowed by the frozen contract.

### `worker/src/routes/ballots.ts`

#### Family ballot

The ballot query:

1. validates the token syntax before querying;
2. joins the token to its family swimmers;
3. reads the singleton voting state;
4. derives `has_voted` using `EXISTS` against `votes`;
5. joins the recorded candidate name when present;
6. converts D1 integer booleans to JSON booleans; and
7. sorts swimmers case-insensitively with an ID tie-breaker.

A well-formed unknown token returns `200 []`, preserving the current Lustre
invalid-link behavior. A malformed token returns `400`.

#### Candidate roster

The roster handler verifies that the family token identifies an existing
family before returning any swimmer names. An existing family with no swimmers
is still authorized to retrieve the team roster. An unknown token returns
`404`.

Candidates are returned in deterministic case-insensitive name order with an
ID tie-breaker. No family email, group, token, or vote state is exposed.

### `worker/src/routes/votes.ts`

The handler validates the token and bounded JSON body, then uses a D1 session
anchored with `first-primary` so diagnostic reads are sequentially consistent
with the attempted write.

The authoritative write is one prepared statement:

```sql
INSERT INTO votes (id, voter_id, candidate_id, created_at)
SELECT ?1, voter.id, candidate.id, ?2
FROM swimmers voter
JOIN families family ON family.id = voter.family_id
JOIN voting_settings settings ON settings.id = 1
JOIN swimmers candidate ON candidate.id = ?3
WHERE family.family_token = ?4
  AND voter.id = ?5
  AND settings.is_open = 1
ON CONFLICT(voter_id) DO NOTHING
RETURNING id
```

All values are bound parameters. The Worker generates the vote ID with
`crypto.randomUUID()` and the timestamp with `Date.toISOString()`.

The statement can insert only when:

- voting is open;
- the token owns the voter;
- the candidate exists; and
- no vote already exists for the voter.

The unique `votes.voter_id` constraint remains authoritative under concurrent
requests. `ON CONFLICT DO NOTHING` converts that specific race into a no-row
result without weakening any other constraint.

If no row is returned, one read-only prepared query determines the existing
result string in the same precedence as the Supabase function:

1. `voting_closed`
2. `not_your_child`
3. `already_voted`
4. `invalid_candidate`

If the write fails without matching one of those states, the handler throws and
the Worker returns `500`; it does not invent a successful business result.

Self-nomination remains allowed because voter and candidate IDs are permitted to
match, exactly as in `supabase/schema.sql`.

Cloudflare recommends typed prepared statements and parameter binding for D1:
[D1 prepared statement methods](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).

### `vitest.config.ts`

The Worker test runtime now loads the versioned D1 migrations as a test-only
binding. Production configuration is unchanged.

### `worker/test/env.d.ts`

Adds only the test-runtime migration binding to `Cloudflare.Env`. Production
`DB`, Queue, assets, and variable types continue to come from
`worker-configuration.d.ts` generated by Wrangler.

### `worker/test/public-api.test.ts`

Adds isolated Worker-runtime integration coverage with a real local D1 binding.
Each test resets storage, reapplies both migrations, and loads prepared-statement
fixtures using UUID-shaped IDs and tokens.

Coverage includes:

- valid ballot shape, order, and integer-to-boolean conversion;
- derived `has_voted` and recorded candidate name after a write;
- unknown and malformed family tokens;
- authorized, sorted candidate roster;
- roster denial for an unknown token;
- successful vote persistence;
- all five frozen vote result strings;
- self-nomination;
- sequential duplicate votes;
- two simultaneous votes for one voter, with exactly one insert;
- malformed JSON; and
- oversized JSON.

### `worker/test/router.test.ts`

Updated router tests for the new `Env` parameter. Public routes now return input
validation errors for the intentionally fake Phase 2 path values, while the six
admin/notification placeholders continue returning `501`.

### `tsconfig.json`

Added Cloudflare's test-runtime ambient types so D1 migration helpers and the
`cloudflare:workers` test environment remain strictly typed.

## Security and privacy properties

- Family token syntax is rejected before database work.
- The candidate roster requires an existing family token.
- Prepared statements bind every user-controlled value.
- Vote ownership and voting state are part of the insert condition.
- Duplicate-vote correctness is database-enforced.
- JSON bodies are bounded before buffering/parsing.
- All public API responses use `Cache-Control: no-store`.
- No public handler logs tokens, URLs, IDs, or request bodies.
- Database errors are not exposed to clients.

## Verification results

Validated locally on 2026-08-14:

- strict TypeScript checking passes;
- two Worker test files pass;
- all 20 Worker tests pass;
- simultaneous duplicate submission produces one `ok`, one `already_voted`,
  and exactly one stored vote; and
- tests execute inside the Cloudflare Workers runtime against a local D1
  binding with the production migrations applied.

No remote database, Worker, Queue, or other Cloudflare resource was accessed or
modified.

## Completion checklist

- [x] Family token syntax validated.
- [x] Family ballot endpoint implemented with frozen response shape.
- [x] Unknown family ballot preserves `200 []` behavior.
- [x] `has_voted` derived from votes instead of duplicate swimmer state.
- [x] Recorded candidate name returned after voting.
- [x] Candidate roster requires a valid family token.
- [x] Candidate roster ordering is deterministic.
- [x] Vote request JSON is content-type checked and size bounded.
- [x] Vote body UUID fields validated.
- [x] Vote insertion is one conditional prepared statement.
- [x] One-vote-per-swimmer constraint remains authoritative.
- [x] All frozen vote result strings preserved.
- [x] Self-nomination remains allowed.
- [x] Concurrent duplicate-vote behavior verified.
- [x] Public responses use `Cache-Control: no-store`.
- [x] Sensitive values are excluded from logs.
- [x] Worker/D1 integration tests pass.
- [x] No remote resources were modified.

## Exit gate

Passed on 2026-08-14. Phase 5 may implement Cloudflare Access JWT validation,
the optional D1 admin allowlist, admin session/roster/results/voting routes, and
the removal of the custom Supabase login behavior from the admin boundary.
