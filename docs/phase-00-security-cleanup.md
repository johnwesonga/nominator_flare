# Phase 0: Security cleanup

Status: **complete**

This phase prevents secrets from entering version control before the Cloudflare
migration begins. No secret values are recorded in this document.

## Audit performed

The repository source, local environment files, generated Supabase state, and Git
metadata were inspected on 2026-08-14.

Findings:

- `supabase/functions/resend/index.ts` reads `RESEND_API_KEY` from the runtime
  environment. It does not contain a literal Resend key.
- `supabase/functions/notify-parents/index.ts` reads the Resend, Supabase URL,
  anonymous key, and service-role key from the runtime environment.
- `supabase/functions/.env` contains a local Resend credential.
- generated files below `supabase/.temp/` contain copied local credentials.
- `src/supabase.gleam` contains the Supabase project URL and a publishable key.
  The publishable key is intentionally client-visible and is not treated as a
  secret. Both values remain temporarily because the application still depends
  on Supabase; Phase 6 removes them.
- the repository has no commits, so there is no Git history to scan or rewrite.
- no private-key blocks or other hard-coded secret patterns were found in the
  application source.

## Changes made

### `.gitignore`

Added rules for:

- `.env` and environment-specific `.env.*` files;
- Wrangler local-secret files (`.dev.vars` and `.dev.vars.*`);
- generated Supabase state (`supabase/.temp/`); and
- local Wrangler state (`.wrangler/`).

The example filenames `.env.example` and `.dev.vars.example` are explicitly
allowed so safe configuration templates can be committed.

### `supabase/functions/.env.example`

Added an empty, commit-safe inventory of the variables used by the existing
Supabase Edge Functions:

- `RESEND_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The real `supabase/functions/.env` remains on the developer machine and is now
ignored. It was not deleted or modified.

## Secret handling during the migration

Sensitive production values must not be added to `wrangler.jsonc`. When the
Worker is introduced, add them interactively with Wrangler, for example:

```sh
npx wrangler secret put RESEND_API_KEY
```

Do not place a secret value in a command argument, documentation, source file,
or committed environment file. Non-sensitive settings such as the application
origin, sender display name, and environment name may be stored in Wrangler
configuration.

## Account-owner actions

These actions cannot be proven or performed from the repository alone:

- [x] Revoke the existing Resend API key in the Resend dashboard.
- [x] Create a replacement key with only the required sending permissions.
- [x] Update the local Supabase function environment and any deployed function
      secret with the replacement value.
- [x] Rotate any other credential that was previously committed, pasted into a
      shared channel, or stored outside the intended secret manager.

Account-owner confirmation received on 2026-08-14. No credential values were
shared during confirmation.

Do not paste replacement values into this document or an issue. Credential
rotation can be marked complete here using only the date and operator name.

## Completion checklist

- [x] Edge Functions obtain sensitive credentials from environment variables.
- [x] Local `.env` files are ignored by Git.
- [x] Wrangler `.dev.vars` files are ignored by Git.
- [x] Generated Supabase and Wrangler state is ignored by Git.
- [x] A safe environment-variable template exists.
- [x] Source files were scanned for common hard-coded credential formats.
- [x] Git history check completed (not applicable: repository has no commits).
- [x] Resend credential revocation and rotation confirmed by the account owner.
- [x] Exposure outside this local repository assessed by the account owner.

## Exit gate

Passed on 2026-08-14. Phase 1 may proceed.
