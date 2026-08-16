# Phase 8: Queue-backed parent notifications

Status: **repository implementation complete; provider and remote Queue setup pending**

This phase replaces the Supabase notification Edge Function with an
Access-protected Worker API, D1 campaign tracking, one Cloudflare Queue message
per family, a retry-safe consumer, Resend delivery, and admin-dashboard progress
polling.

Resend remains the initial provider, as recommended in the migration plan. The
provider call is isolated in one adapter so a later move to Cloudflare Email
Sending does not change campaign, Queue, D1, template, or frontend behavior.

## Runtime flow

```text
Admin POST /api/admin/notifications
  → validate Access identity and notification configuration
  → reuse or create one campaign for the configured seasonal key
  → create one D1 delivery row per family
  → enqueue messages containing only campaign ID + family ID
  → return 202 Accepted with campaign progress

Queue consumer
  → load family/token/swimmers from D1
  → build escaped HTML + plain text
  → send through Resend with a stable idempotency key
  → atomically recalculate delivery and campaign counts
  → acknowledge, retry with backoff, or enter the DLQ path

Admin dashboard
  → poll GET /api/admin/notifications/:campaignId every two seconds
  → stop when completed or failed
```

## API contract

### Start or resume a campaign

```http
POST /api/admin/notifications
```

Returns `202 Accepted`:

```json
{
  "id": "campaign-uuid",
  "status": "queued",
  "total": 120,
  "queued": 120,
  "sent": 0,
  "failed": 0
}
```

The endpoint is idempotent for `NOTIFICATION_CAMPAIGN_KEY`. Repeating it returns
the original campaign and re-enqueues only unfinished delivery records. It never
creates a second campaign for the same seasonal key.

If a different campaign is already active, it returns `409 conflict`. An empty
family table creates an immediately completed zero-delivery campaign.

### Read progress

```http
GET /api/admin/notifications/:campaignId
```

Returns the same campaign shape with current counts. Malformed IDs return `400`;
unknown IDs return `404`. Both routes remain protected by the Phase 5 Access
assertion and D1 administrator allowlist.

## Files changed

### `d1/migrations/0004_notification_campaign_keys.sql`

Added `notification_campaign_keys`, a strict table that maps one permanent
configured seasonal key to one campaign. Both the key and campaign ID are
unique, with a cascading foreign key to `notification_campaigns`.

This complements the earlier partial unique index that allows only one queued or
sending campaign at a time. Together they prevent both simultaneous campaigns
and accidental repeats after a campaign completes.

### `worker/src/routes/notifications.ts`

Implemented campaign creation/resumption and progress lookup.

Campaign creation uses one D1 batch to insert:

- the campaign and authoritative counts;
- its permanent seasonal idempotency key; and
- one queued delivery row for every family via `INSERT ... SELECT`.

Queue publication is awaited before returning. Outstanding messages are sent in
chunks of at most 100, within Cloudflare's current `sendBatch` limit. If Queue
publication fails after any chunk, the HTTP request fails while D1 remains
resumable; repeating the request re-enqueues outstanding deliveries. Provider
and D1 idempotency make duplicate Queue messages safe.

Cloudflare documents that Queue sends are confirmed written when the returned
promise resolves and that `sendBatch` accepts at most 100 messages:
[Queues JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/).

### `worker/src/email/messages.ts`

Defines and validates the structured-clone-safe Queue body:

```json
{
  "campaignId": "...",
  "familyId": "..."
}
```

No family token, email address, swimmer name, complete voting URL, or email body
is placed on the Queue.

### `worker/src/email/templates.ts`

Creates both HTML and plain-text voting invitations. Swimmer names and URLs are
HTML-escaped before interpolation. The private voting URL is built only inside
the consumer from the configured application origin and D1 family token.

### `worker/src/email/resend.ts`

Added the isolated Resend REST adapter. It:

- uses the `RESEND_API_KEY` secret;
- sends HTML and plain text;
- supplies a stable `Idempotency-Key` per campaign/family;
- validates and bounds provider responses to 8 KiB;
- treats `429` and `5xx` responses as retryable;
- treats other `4xx` responses as permanent; and
- returns only the provider message ID to the consumer.

Resend documents that idempotency keys prevent duplicate sends and remain valid
for 24 hours:
[Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

### `worker/src/email/consumer.ts`

Implemented per-message Queue consumption with explicit acknowledgement and
retry decisions.

The consumer:

- validates every message body;
- acknowledges missing, already-sent, or already-failed deliveries;
- records the Cloudflare delivery attempt number;
- loads recipient/token/names from D1;
- validates the application origin and sender configuration;
- sends using the stable provider idempotency key;
- stores the provider message ID on success;
- stores only an operational error code on failure;
- recalculates campaign counts from delivery rows after terminal outcomes;
- retries transient failures with bounded exponential backoff; and
- marks the fourth failed attempt terminal before retrying it into the configured
  dead-letter Queue path.

Each message is explicitly acknowledged as it succeeds, so one failure does not
redeliver other messages in the same batch. Cloudflare recommends per-message
acknowledgement when calling external APIs and supports explicit delayed retries:
[Queue batching and retries](https://developers.cloudflare.com/queues/configuration/batching-retries/).

### `worker/src/index.ts`

Replaced the Phase 2 Queue placeholder with the typed notification consumer.
The exported handler now declares `NotificationMessage` as its Queue body type.

### `worker/src/responses.ts`

Added the stable `conflict` API error code for attempts to start a different
campaign while another is active.

### `wrangler.jsonc`

Declared `RESEND_API_KEY` under `secrets.required` for development, preview, and
production. Wrangler now generates its type and validates that the secret exists
before deployment without putting its value in source control.

Added non-sensitive per-environment values:

- `NOTIFICATION_CAMPAIGN_KEY`;
- `SENDER_EMAIL`; and
- the existing `SENDER_NAME` and `APPLICATION_ORIGIN` inputs.

The sender email is a fail-closed placeholder. It must be replaced with an
address on a verified domain. Cloudflare documents required-secret declarations
and generated binding types:
[Wrangler secrets configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

### `.dev.vars.example`

Added a safe local template containing only a clearly fake Resend value. Real
local values belong in ignored `.dev.vars`; preview and production values belong
in Wrangler secrets.

### `src/api.gleam`

Added the `NotificationCampaign` type and decoder. Starting a notification now
expects the `202` JSON campaign rather than an empty success response. Added the
same-origin campaign progress request.

### `src/admin.gleam`

The dashboard now displays queued, sent, failed, and total counts. It polls active
campaigns every two seconds and automatically stops on `completed` or `failed`.
Repeated button clicks remain safe because the backend seasonal key is
authoritative.

### `src/app_timer.gleam` and `src/timer_ffi.mjs`

Added a small Lustre effect backed by browser `setTimeout` for progress polling.
The Erlang fallback is inert, keeping Gleam tests deterministic.

### Tests and validation scripts

`worker/test/notifications.test.ts` adds Worker-runtime coverage for:

- campaign creation and seasonal reuse;
- one delivery per family;
- progress lookup and unknown campaigns;
- Resend request content and stable idempotency header;
- HTML escaping and plain-text URLs;
- successful completion and stored provider ID;
- sent-delivery redelivery suppression;
- transient retries without incorrect counter changes;
- permanent failures; and
- terminal retry/DLQ state.

The Access test now expects an authorized notification request to return `202`.
Gleam tests cover campaign decoding and completed-progress notices.
`scripts/test-d1.mjs` applies migration 0004 and verifies campaign-key uniqueness.

`vitest.config.ts` supplies test-only sender, origin, seasonal key, and fake
secret bindings. `package.json` supplies the fake `.dev.vars.example` only to
Wrangler's deployment dry run; it is never used for a real deployment.

## Privacy and logging

Structured logs contain event names only. They do not include:

- parent email addresses;
- family IDs or tokens;
- campaign IDs;
- swimmer names;
- voting URLs;
- email content;
- Access assertions; or
- Resend credentials.

D1 delivery errors contain bounded operational codes such as
`resend_http_503`, never provider response bodies.

## Verification results

Validated locally on 2026-08-14:

- migration `0004_notification_campaign_keys.sql` is applied to local D1;
- strict TypeScript checking passes;
- D1 schema and constraint checks pass;
- four Worker test files pass;
- all 39 Worker tests pass;
- all eight Gleam tests pass;
- frontend production packaging passes;
- generated Worker binding types are current; and
- Wrangler deployment dry-run passes without a remote deployment.

No email was sent, and no remote D1 database, Queue, secret, Worker, Access
application, or DNS record was created or modified.

## Repository completion checklist

- [x] Campaign creation endpoint returns `202 Accepted`.
- [x] Campaign progress endpoint is implemented.
- [x] One D1 delivery record is created per family.
- [x] One ID-only Queue message is produced per outstanding family.
- [x] Queue publication is awaited and chunked safely.
- [x] Seasonal campaign idempotency is database-enforced.
- [x] Only one active campaign can exist.
- [x] Queue messages are runtime-validated.
- [x] HTML and plain-text email bodies are generated.
- [x] Swimmer names and URLs are HTML-escaped.
- [x] Voting URLs use the configured application origin.
- [x] Resend calls use a stable provider idempotency key.
- [x] Successful provider message IDs are stored.
- [x] Transient provider failures retry with backoff.
- [x] Permanent failures are acknowledged and recorded.
- [x] Terminal transient failures enter the DLQ path.
- [x] Duplicate delivery is suppressed after success.
- [x] Campaign counts are recalculated from authoritative deliveries.
- [x] Admin dashboard polls and displays campaign progress.
- [x] Resend API key is declared as a required secret.
- [x] Sensitive values and email contents are excluded from logs.
- [x] Worker, Gleam, D1, frontend, and dry-run checks pass.
- [x] No remote resource or recipient was touched.

## Required external setup before sending

- [ ] Revoke the historical exposed Resend key if Phase 0 rotation is still
  incomplete.
- [ ] Verify the production sender domain in Resend.
- [ ] Replace every `SENDER_EMAIL` placeholder.
- [ ] Confirm and update `NOTIFICATION_CAMPAIGN_KEY` for the actual voting season.
- [ ] Set `RESEND_API_KEY` interactively for preview and production.
- [ ] Create each configured producer Queue and dead-letter Queue.
- [ ] Apply migration 0004 to preview and production D1.
- [ ] Send first to a controlled real address, never a fabricated address.
- [ ] Verify HTML, plain text, sender identity, SPF, DKIM, and DMARC behavior.
- [ ] Verify retry and dead-letter monitoring in the Cloudflare dashboard.
- [ ] Confirm that the voting invitation is transactional under the chosen
  provider's acceptable-use policy.

## Exit gate

Phase 8 is complete in the repository. Phase 9 may export, transform, validate,
and load production data into D1. Real email delivery remains blocked by the
explicit provider, secret, sender-domain, Queue, and controlled-recipient setup
above.
