# Phase 11: Deployment and operations

Status: **preview acceptance complete; production setup and deployment pending**

The registered `projozangu.com` zone is split between two isolated Worker
environments:

| Environment | Worker | Custom domain | Application origin |
|---|---|---|---|
| Preview | `nominator-flare-preview` | `preview.projozangu.com` | `https://preview.projozangu.com` |
| Production | `nominator-flare-production` | `nominator.projozangu.com` | `https://nominator.projozangu.com` |

Two environments cannot own the same hostname simultaneously. The preview
subdomain prevents test deployments, D1 data, Access policies, and email
configuration from colliding with production.

## Files changed

### `wrangler.jsonc`

Added an environment-specific Worker Custom Domain under both `env.preview` and
`env.production`. Each uses the exact-hostname form with
`custom_domain: true`; no wildcard or path is needed because the Worker serves
the complete SPA and API for that hostname.

Updated `APPLICATION_ORIGIN` in both environments. The Queue email consumer
uses this value to construct private voting links, so preview mail points only
to preview and production mail points only to production.

Added the provisioned preview D1 `database_id` to the existing `DB` binding
inside `env.preview`. The initial Wrangler-generated snippet had been appended
at the top level with binding name `nominator_preview`; that entry was removed
because named-environment D1 bindings are not inherited and the Worker code
requires the binding name `DB`.

Added the independently provisioned production D1 database ID to
`env.production.DB`. The production database is named `nominator-production`
and is not shared with preview.

Cloudflare recommends Custom Domains when the Worker itself is the origin.
Wrangler will create the associated DNS record and certificate when the
environment is deployed:
[Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

### `worker-configuration.d.ts`

Regenerated from Wrangler so the environment-specific application-origin
literal types match the configured hostnames.

### `README.md`

Replaced example hostnames with the real preview and production paths required
for Cloudflare Access.

## Preview Cloudflare setup

Before preview deployment:

- [x] Confirm `projozangu.com` is an active zone in the same Cloudflare account
  used by Wrangler.
- [x] Confirm `preview.projozangu.com` has no conflicting CNAME record. A Custom
  Domain cannot be created on a hostname with an existing CNAME.
- [x] Create `nominator-preview` D1 and put its `database_id` in Wrangler if it
  is not automatically provisioned.
- [x] Create `nominator-email-preview` and
  `nominator-email-preview-dlq` Queues.
- [x] Replace preview `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` placeholders.
- [x] Replace the preview sender placeholder and set `RESEND_API_KEY`
  interactively.
- [x] Apply all D1 migrations and add the normalized manager email to `admins`.
- [x] Create Access protection for both preview admin paths.

Repeat with distinct production D1, Queues, Access application/audience,
sender configuration, secret, and administrator allowlist before production.

## Production Cloudflare setup

Production infrastructure configured on 2026-08-15:

- [x] Created the isolated `nominator-production` D1 database and bound its ID
  to `env.production.DB`.
- [x] Created `nominator-email-production` and
  `nominator-email-production-dlq`.
- [x] Applied migrations `0001` through `0004`; Wrangler reports no pending
  migrations.
- [x] Verified production initially contained zero families, swimmers, votes,
  and admins before allowlist configuration.
- [x] Regenerated Worker binding types and passed the production deployment dry
  run.
- [x] Passed the complete local release gate on 2026-08-15: 15 Gleam tests, 42
  Worker tests, D1 and migration checks, static packaging, types, and deployment
  dry run.
- [x] Confirm the production Access application protects both `/admin*` and
  `/api/admin/*` on `nominator.projozangu.com` and that its audience matches
  `env.production.ACCESS_AUD`. The application owner confirmed the destination
  and unchanged AUD on 2026-08-15.
- [x] Inserted the approved normalized production administrator
  `johnwesonga@gmail.com` into D1 and verified it is the sole allowlist row.
  The test-only `manager@example.com` identity was not loaded.
- [x] Rotate the exposed Resend credential and set the replacement
  `RESEND_API_KEY` interactively for both preview and production. Secret-name
  verification succeeded without retrieving either value.
- [x] Confirmed there are no Supabase application records to import. Phase 9 is
  documented as a no-data migration; production fixtures were not loaded.
- [ ] Deploy the production Worker only after the data migration and explicit
  cutover approval.
- [ ] Apply Phase 12 migration `0005_family_management_audit.sql` only after its
  preview deployment and family-management acceptance pass.

## Access application paths

Protect only these paths so public ballots remain anonymous:

```text
preview.projozangu.com/admin*
preview.projozangu.com/api/admin/*
nominator.projozangu.com/admin*
nominator.projozangu.com/api/admin/*
```

Use an Allow policy restricted to the manager's exact email or trusted IdP
group. Do not protect the entire hostname and do not create an Everyone policy.

## Deployment gates

Run locally before either environment:

```sh
npm run check
```

Validate the resolved preview package without publishing:

```sh
WRANGLER_WRITE_LOGS=false npx wrangler deploy --dry-run --env preview \
  --outdir .wrangler/dry-run-preview
```

Only after all placeholders, bindings, Queues, migrations, secrets, and Access
paths are ready should an operator run:

```sh
npx wrangler deploy --env preview
```

Production deployment follows preview acceptance and an explicit approval:

```sh
npx wrangler deploy --env production
```

Neither deployment command has been run as part of this change.

## Current checklist

- [x] Preview and production use different Worker names.
- [x] Preview and production use different custom hostnames.
- [x] Preview D1 is bound as `env.preview.DB` with its remote database ID.
- [x] Application origins match their custom hostnames.
- [x] `workers.dev` and generated preview URLs remain disabled.
- [x] Static SPA and API share the same origin.
- [x] Generated Worker types are current.
- [x] Local automated release gate passes.
- [x] Preview configuration dry-run resolves `preview.projozangu.com` and its
  preview-only bindings.
- [x] Production configuration dry-run resolves `nominator.projozangu.com` and its
  production-only bindings.
- [x] Preview remote resources are isolated from the production environment.
- [x] Preview Cloudflare resources and Access policy are configured.
- [x] Preview deployment and Phase 10 browser acceptance pass.
- [ ] Production resources are configured independently.
- [ ] Production deployment is approved and completed.

## Exit gate

The preview environment is provisioned, deployed, and accepted. Phase 11
remains incomplete until production resources are independently configured and
the production deployment is explicitly approved.
