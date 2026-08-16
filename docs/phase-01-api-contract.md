# Phase 1: Frozen API contract

Status: **complete**

This document is the authoritative HTTP contract for the Supabase-to-Cloudflare
migration. Worker implementation and frontend migration must conform to it. Any
later change to the shapes below requires an explicit contract revision and
decoder tests.

## Scope and evidence

The current contract was reconstructed from these frontend sources:

- `src/supabase.gleam`: base URL, headers, and transport behavior;
- `src/api.gleam`: endpoints, request bodies, and response decoders;
- `src/types.gleam`: candidate, roster, and results row decoders;
- `src/family.gleam`: ballot behavior and vote result handling;
- `src/admin.gleam`: authentication and admin action behavior; and
- `supabase/functions/notify-parents/`: notification authorization and result
  behavior.

The repository contains no SQL migrations or schema dump, so database-function
internals could not be inspected. The frontend-visible shapes below are frozen;
Phase 3 must verify the inferred database field semantics against an export or
the live Supabase schema before creating D1 migrations.

## General rules

- All new application endpoints are same-origin and begin with `/api/`.
- Request and response bodies use UTF-8 JSON unless a successful endpoint is
  explicitly documented as returning no body.
- JSON field names use `snake_case`.
- IDs and family tokens are JSON strings.
- Timestamps are ISO 8601 strings in UTC when present.
- Public ballot and all admin responses include `Cache-Control: no-store`.
- Successful JSON responses use `Content-Type: application/json`.
- The Worker must not log family tokens, voting URLs, credentials, Access JWTs,
  or request bodies containing those values.
- Unknown request JSON fields may be ignored. Missing, incorrectly typed, or
  malformed required fields return `400`.

### Error envelope

Unless an endpoint explicitly returns a vote result string, non-success
responses use:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "The request could not be processed.",
    "request_id": "opaque-request-id"
  }
}
```

`code` is stable and machine-readable. `message` is safe for display and must
not expose SQL, provider, token, or authentication details. `request_id` is safe
to log and use for support correlation.

Common status codes:

| Status | Meaning |
|---|---|
| `400` | Malformed path parameter or JSON body |
| `401` | Missing or invalid Cloudflare Access identity |
| `403` | Authenticated identity is not authorized |
| `404` | API route or requested resource does not exist |
| `405` | Method not allowed |
| `409` | Conflicting campaign or state transition |
| `500` | Unexpected server failure |
| `502` | Required upstream provider failure |

## Current-to-target mapping

| Responsibility | Current Supabase request | Frozen Worker request |
|---|---|---|
| Family ballot | `POST /rest/v1/rpc/get_family_ballot` | `GET /api/ballots/:familyToken` |
| Candidate roster | `GET /rest/v1/swimmer_roster?select=id,name` | `GET /api/ballots/:familyToken/candidates` |
| Cast vote | `POST /rest/v1/rpc/cast_vote` | `POST /api/ballots/:familyToken/votes` |
| Login/session | `POST /auth/v1/token?grant_type=password` | `GET /api/admin/session` |
| Admin roster | `POST /rest/v1/rpc/get_admin_roster` | `GET /api/admin/roster` |
| Results | `POST /rest/v1/rpc/get_results` | `GET /api/admin/results` |
| Voting state | `POST /rest/v1/rpc/set_voting_open` | `PUT /api/admin/voting` |
| Notify parents | `POST /functions/v1/notify-parents` | `POST /api/admin/notifications` |
| Campaign progress | None | `GET /api/admin/notifications/:campaignId` |

The old `apikey` header and frontend-managed bearer token are not part of the new
contract. Cloudflare Access handles the browser session; the Worker validates
the Access assertion on every admin request.

## Public endpoints

### `GET /api/ballots/:familyToken`

Returns the swimmers belonging to the family link and the current voting state.
An unknown, expired, or well-formed but nonexistent token returns `200` with an
empty array to preserve the current invalid-link behavior. A syntactically
malformed token returns `400`.

Response `200`:

```json
[
  {
    "swimmer_id": "swimmer-uuid",
    "swimmer_name": "Example Swimmer",
    "has_voted": false,
    "voting_open": true,
    "voted_for_name": null
  }
]
```

Field rules:

| Field | Type | Rule |
|---|---|---|
| `swimmer_id` | string | Family swimmer ID |
| `swimmer_name` | string | Family swimmer display name |
| `has_voted` | boolean | Derived from an existing vote |
| `voting_open` | boolean | Same value on every returned row |
| `voted_for_name` | string or null | Recorded candidate name, if available |

### `GET /api/ballots/:familyToken/candidates`

The Worker validates that the family token exists before exposing the roster.
An unknown token returns `404`.

Response `200`:

```json
[
  {
    "id": "candidate-uuid",
    "name": "Candidate Name"
  }
]
```

The response is a JSON array, sorted by name using a deterministic,
case-insensitive ordering. An empty roster is a valid `200` response.

### `POST /api/ballots/:familyToken/votes`

Request:

```json
{
  "voter_swimmer_id": "voter-uuid",
  "candidate_id": "candidate-uuid"
}
```

The family token is present only in the path. The Worker must perform the vote
write atomically and let the database uniqueness constraint on the voter enforce
one vote per swimmer.

All expected business outcomes return `200` with a JSON string so the current
Gleam decoder remains valid:

```json
"ok"
```

Allowed result strings:

| Result | Meaning |
|---|---|
| `ok` | Vote inserted |
| `already_voted` | A vote already exists for this voter |
| `voting_closed` | Voting is not open |
| `not_your_child` | Voter does not belong to the token's family |
| `invalid_candidate` | Candidate does not exist or is ineligible |

Malformed JSON or syntactically invalid identifiers return `400` using the
normal error envelope. Unexpected storage failures return `500`; they must not
be converted into a business result string.

## Admin endpoints

Every endpoint in this section requires a valid Cloudflare Access assertion and
the configured admin authorization policy.

### `GET /api/admin/session`

Response `200`:

```json
{
  "email": "manager@example.com"
}
```

The email is taken from the validated Access identity. The response does not
contain an Access token or application JWT.

### `GET /api/admin/roster`

Response `200`:

```json
[
  {
    "family_id": "family-uuid",
    "family_email": "parent@example.com",
    "family_token": "opaque-family-token",
    "swimmer_id": "swimmer-uuid",
    "swimmer_name": "Example Swimmer",
    "group_name": null,
    "has_voted": false
  }
]
```

`group_name` is a string or `null`. `has_voted` is derived from the votes table.
Rows are sorted deterministically by family email and swimmer name.

### `GET /api/admin/results`

Response `200`:

```json
[
  {
    "candidate_id": "candidate-uuid",
    "candidate_name": "Candidate Name",
    "vote_count": 3
  }
]
```

`vote_count` is a non-negative JSON integer. Rows are ordered by vote count
descending, then candidate name case-insensitively.

### `PUT /api/admin/voting`

Request:

```json
{
  "open": true
}
```

Response: `204 No Content`. Repeating the current state is successful and
idempotent. The authenticated admin email is recorded in an audit event without
recording the Access assertion.

### `POST /api/admin/notifications`

Creates and queues one notification campaign. It does not synchronously send all
emails.

Request:

```json
{}
```

Response `202`:

```json
{
  "campaign_id": "campaign-uuid",
  "status": "queued",
  "total": 42,
  "queued": 42,
  "sent": 0,
  "failed": 0
}
```

Starting a conflicting campaign returns `409`. Campaign creation and per-family
delivery records must be idempotent.

### `GET /api/admin/notifications/:campaignId`

Response `200`:

```json
{
  "campaign_id": "campaign-uuid",
  "status": "sending",
  "total": 42,
  "queued": 10,
  "sent": 31,
  "failed": 1
}
```

Allowed status values are `queued`, `sending`, `completed`, and `failed`.
Counters are non-negative integers, and `queued + sent + failed` equals `total`.
An unknown campaign ID returns `404`.

## Frontend migration constraints

- Keep the existing ballot, candidate, admin roster, results, and vote-result
  decoders unchanged where their documented response shapes are identical.
- Change `family.init` so its token is supplied to both ballot and candidate
  requests.
- Remove the Supabase base URL, publishable key, `apikey` header, login call, and
  frontend JWT propagation.
- Initialize the admin view with `/api/admin/session` and let Access handle login.
- Add decoders for the notification `202` response and campaign progress.
- Replace user-facing references to Supabase in transport errors and admin copy.

## Completion checklist

- [x] Every current frontend API call was inventoried.
- [x] Every current response decoder was inventoried.
- [x] Public same-origin routes and methods were frozen.
- [x] Admin same-origin routes and methods were frozen.
- [x] Request bodies and response bodies were frozen.
- [x] Vote business result strings were preserved.
- [x] Error envelope and HTTP status behavior were defined.
- [x] Authentication boundary was defined without frontend JWT storage.
- [x] Notification creation and progress contracts were defined.
- [x] Caching, ordering, and sensitive logging rules were recorded.
- [x] Missing database schema evidence was recorded as a Phase 3 verification
      requirement.

## Exit gate

Passed on 2026-08-14. Phase 2 may create the Worker project, but it must implement
this contract and must not silently change these JSON shapes.
