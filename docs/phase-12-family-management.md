# Phase 12: Safe family management

Status: **complete in preview**

This phase adds Access-protected family and swimmer administration without
weakening vote integrity. It supplements the existing read-only roster; public
ballot contracts remain unchanged.

## API contract

| Method | Endpoint | Behavior |
|---|---|---|
| `GET` | `/api/admin/families` | List every family, including empty families, with nested swimmers |
| `POST` | `/api/admin/families` | Create a normalized family and generate its ID and private token |
| `PUT` | `/api/admin/families/:id` | Update the unique family email |
| `DELETE` | `/api/admin/families/:id` | Delete only when no swimmers remain |
| `POST` | `/api/admin/families/:id/swimmers` | Add a swimmer to an existing family |
| `PUT` | `/api/admin/swimmers/:id` | Update swimmer name and optional group |
| `DELETE` | `/api/admin/swimmers/:id` | Delete only when no vote references the swimmer |

All endpoints require a valid Cloudflare Access assertion and the D1 admin
allowlist. Responses use `Cache-Control: no-store`. JSON request bodies retain
the existing 4 KiB bound.

## Validation and safety rules

- Family email is trimmed, lowercased, limited to 254 characters, syntactically
  checked, and protected by a case-insensitive unique D1 index.
- Family IDs and tokens are generated with `crypto.randomUUID()`.
- Swimmer names are trimmed and limited to 120 characters.
- Optional group names are trimmed, empty strings become `null`, and values are
  limited to 80 characters.
- Route IDs must use canonical UUID syntax.
- A family with swimmers returns `409` instead of cascading deletion.
- A swimmer referenced as either voter or candidate returns `409` instead of
  deleting or rewriting a vote.
- D1 foreign keys remain the final integrity boundary.
- Every successful mutation records the authenticated administrator, bounded
  event type, target type, and target UUID in `admin_audit_events`.
- Family tokens and complete voting URLs are never written to logs.

## Database change

Migration `0005_family_management_audit.sql` rebuilds the audit table with six
additional allowed event types while preserving existing voting audit rows:

```text
family_created
family_updated
family_deleted
swimmer_created
swimmer_updated
swimmer_deleted
```

## Frontend behavior

The dashboard now loads a family-centric model alongside the existing roster
and results. A single explicit management form supports creating or editing a
family, creating or editing a swimmer, and confirming deletion. Family cards
include empty families, nested swimmers, group and vote state, and a private
voting-path field.

The copy control sends only the relative `/vote/:token` path to a small browser
clipboard adapter. The adapter resolves it against the current origin at click
time, ensuring preview and production links cannot cross environments. Tokens
are never logged.

Delete buttons are disabled when the client already knows deletion is unsafe,
and every delete still requires a confirmation form. The Worker and D1 remain
authoritative because a swimmer may also be referenced as a candidate even when
their own `has_voted` flag is false.

The layout collapses family headers, swimmer rows, link controls, and form
columns for mobile viewports.

## Implementation checklist

- [x] API contract frozen.
- [x] Audit migration created.
- [x] Family and swimmer Worker routes implemented.
- [x] Bounded validation and UUID generation implemented.
- [x] Safe deletion predicates implemented.
- [x] Worker authorization, CRUD, conflict, and audit tests pass.
- [x] Gleam decoders and transport functions implemented.
- [x] Admin family-management state and UI implemented.
- [x] Confirmation is required before family or swimmer deletion.
- [x] Copy-voting-link control implemented without logging tokens.
- [x] Mobile layout rules added.
- [x] Frontend decoder, state, build, and static-package tests pass.
- [x] Full release gate passes: 17 Gleam tests, 54 Worker tests, D1 and
  migration checks, static packaging, type checks, and preview/production dry
  runs.
- [x] Preview migration `0005` applied with no pending migrations.
- [x] Preview Worker version `604e8a45-d708-4569-be8c-0a56c97dc146`
  deployed.
- [x] Preview homepage, Access redirect, and public API smoke checks pass.
- [x] Authenticated preview family-management acceptance completed and confirmed
  by the application owner on 2026-08-16.

## Exit gate

Phase 12 has passed the full local release gate and authenticated preview
acceptance. Production deployment remains a separate explicit approval.
