# Phase 7: Production static assets

Status: **complete**

This phase makes the Lustre frontend a deterministic Cloudflare Workers Static
Assets package. Direct SPA routes return the application shell, `/api/*` runs
through the Worker first, fingerprinted local assets receive immutable caching,
and HTML routes remain non-cacheable.

## Production artifact

`npm run build:frontend` now produces this layout:

```text
dist/
  _headers
  index.html
  assets/
    nominator_flare.<sha256-prefix>.js
    styles.<sha256-prefix>.css
```

The 16-character lowercase hexadecimal filename component is the leading portion
of the file's SHA-256 digest. Identical source output therefore produces the
same URLs, while changed contents produce new URLs.

`index.html` is rewritten to reference both fingerprinted files. The original
unhashed `nominator_flare.js` and `styles.css` files are moved out of the root,
so deploys cannot accidentally publish mutable and immutable aliases.

## Routing and caching

The existing `wrangler.jsonc` Static Assets configuration was verified and
retained:

```jsonc
{
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  }
}
```

This provides:

- SPA fallback to `index.html` for `/`, `/admin`, and `/vote/:familyToken`;
- explicit Worker-first routing for every `/api/*` request; and
- direct edge delivery for generated static files.

Cloudflare documents both SPA fallback and selective Worker-first path patterns:
[Static Assets SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

The generated `_headers` file applies:

| Paths | `Cache-Control` |
|---|---|
| `/`, `/index.html`, `/admin*`, `/vote/*` | `no-store` |
| `/assets/*` | `public, max-age=31536000, immutable` |

All static responses also receive:

- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`; and
- `X-Frame-Options: DENY`.

Cloudflare supports overriding Static Assets response headers with a generated
`_headers` file:
[Static Assets custom headers](https://developers.cloudflare.com/workers/static-assets/headers/).

API responses do not inherit these static-file rules. Their existing Worker
response helpers continue to send `Cache-Control: no-store`.

## Files changed

### `scripts/package-frontend.mjs`

Added the deterministic post-build packager. It:

1. removes only the previously generated `dist/assets` directory;
2. recreates that directory;
3. reads the generated JavaScript and copied stylesheet;
4. calculates SHA-256 content fingerprints;
5. moves each file to its fingerprinted name;
6. verifies the expected original URL exists in `index.html`;
7. rewrites all original local asset URLs; and
8. writes the production `_headers` rules.

The script fails the build if Lustre changes its expected output references,
preventing a silently broken deployment.

### `scripts/test-static-assets.mjs`

Added artifact validation that requires:

- exactly one correctly fingerprinted JavaScript bundle;
- exactly one correctly fingerprinted stylesheet;
- exactly two files in `dist/assets`;
- existing files for every local reference in `index.html`;
- no unhashed script or stylesheet URL;
- immutable caching for `/assets/*`; and
- non-cacheable admin and ballot SPA shells.

### `package.json`

The frontend build now runs the packaging script after Lustre generation and
stylesheet copying. Added `npm run test:static`, and placed it in the main
`npm run check` gate before Worker type, D1, runtime-test, and deployment checks.

### `.github/workflows/test.yml`

CI now installs Node dependencies and runs the same complete `npm run check`
used locally. Gleam formatting and tests remain explicit CI gates. This adds
frontend production build, artifact validation, generated Worker type checks,
TypeScript, D1 schema checks, Worker runtime tests, and Wrangler dry-run
validation to every pull request and main-branch push.

### `README.md`

Advanced the repository status through Phase 7 and documented that `dist/` is a
generated, fingerprinted Static Assets package.

## Local HTTP verification

The packaged application was served through local Wrangler and checked over
HTTP, not only by reading configuration:

| Request | Status | Content type | Cache policy |
|---|---:|---|---|
| `/` | 200 | `text/html` | `no-store` |
| `/admin` | 200 | `text/html` | `no-store` |
| `/vote/<token>` | 200 | `text/html` | `no-store` |
| fingerprinted JavaScript | 200 | `text/javascript` | one year, immutable |
| fingerprinted stylesheet | 200 | `text/css` | one year, immutable |
| `/api/unknown` | 404 | `application/json` | `no-store` |

Wrangler parsed all six generated header rules successfully. Its request logs
confirmed that `/admin` and `/vote/:token` used SPA `not_found_handling`, while
`/api/unknown` executed the Worker and returned the JSON API envelope.

Cloudflare's current Workers best practices were also reviewed for this phase:
[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
The project uses a current compatibility date, generated `Env` types,
`nodejs_compat`, bindings rather than REST calls, structured error logging, and
Workers-runtime tests.

## Verification results

Validated locally on 2026-08-14:

- deterministic frontend build succeeds;
- static artifact checks pass;
- direct SPA navigation and refresh routes return `index.html`;
- hashed local assets return correct MIME and immutable cache headers;
- API paths execute the Worker before SPA fallback;
- the full `npm run check` gate passes;
- all 32 Worker tests pass;
- all six Gleam tests pass; and
- Wrangler deployment dry-run succeeds with the packaged assets.

No remote Worker, asset deployment, DNS route, or Cloudflare configuration was
created or modified.

## Completion checklist

- [x] Deterministic Lustre production build command established.
- [x] Generated HTML, JavaScript, and CSS are packaged under `dist/`.
- [x] JavaScript filename is content-fingerprinted.
- [x] Stylesheet filename is content-fingerprinted.
- [x] `index.html` references only fingerprinted local assets.
- [x] Stale generated assets are removed before packaging.
- [x] Hashed assets use immutable browser caching.
- [x] Root, admin, ballot, and index HTML are non-cacheable.
- [x] Static security headers are applied.
- [x] `/admin` direct navigation and refresh use SPA fallback.
- [x] `/vote/:token` direct navigation and refresh use SPA fallback.
- [x] `/api/*` routes run through the Worker first.
- [x] Unknown API paths return JSON rather than `index.html`.
- [x] Artifact validation is part of the main check command.
- [x] CI runs the complete frontend and Worker validation gate.
- [x] Local HTTP behavior was smoke-tested through Wrangler.
- [x] No remote resources were modified.

## External verification before deployment

- [ ] Complete the Phase 5 Cloudflare Access account checklist.
- [ ] Configure real preview and production custom hostnames.
- [ ] Deploy to preview and inspect cache/security headers at the edge.
- [ ] Verify Access redirects and returns to a direct `/admin` navigation.
- [ ] Verify a real `/vote/:familyToken` page after browser refresh.
- [ ] Confirm the external Bootstrap and Google Fonts resources are allowed by
  the final Content Security Policy if a CSP is added during hardening.

## Exit gate

Phase 7 is complete in the repository. Phase 8 may implement Queue-backed parent
notification campaigns and email delivery without further frontend-hosting
changes.
