# Changelog

Notable changes to `scalable-capital-owncloud`. Format follows
[Keep a Changelog](https://keepachangelog.com/) and the version follows
[SemVer](https://semver.org/).

## [0.0.2] — 2026-06-10

Aligns the scaffold with the post-Refactor-B shape of gbm-owncloud
(v0.14.17+) and Trade-Republic-owncloud (v0.1.38+): shared DI plumbing
moved to a `BaseOwnCloudService` parent class so the three trios stay
structurally identical instead of drifting.

### What changed

- **New `lib/Service/BaseOwnCloudService.php`** (171 lines, vendored
  triplet — namespace differs, body matches gbm + TR byte-for-byte
  except for the docblock):
  - DI-friendly constructor (`IUserSession` + `IConfig` + `ICrypto`)
  - Lazy `userId()` — security boundary against cross-user access
  - `userDir()` per-user data dir under `{datadir}/<uid>/scalable_capital/`
  - `runProcess()` proc_open wrapper with timeout enforcement and
    fetch.log persisted into userDir()
  - Canonical `EXIT_OK` / `EXIT_MFA_REQUIRED` / `EXIT_MFA_INVALID` /
    `EXIT_AUTH_FAILED` / `EXIT_API_ERROR` / `EXIT_TIMEOUT` /
    `EXIT_RATE_LIMITED` / `EXIT_CONFIG_ERROR` constants
- **`lib/Service/ScalableService.php`**: refactored from 177 → 124
  lines. Now extends `BaseOwnCloudService` and only carries
  Scalable-specific logic (email config, cookies.txt presence check,
  Scalable's runFetch + Python venv resolution).
- **`lib/Controller/ApiController.php`**: removed the 7 local
  `EXIT_*` constants — they now come from `ScalableService` (mirror
  of how Trade-Republic-owncloud's ApiController references
  `TrService::EXIT_*`).

### Why now

Carlos pointed out the SC scaffold was lagging behind gbm + TR after
the refactor train shipped in v0.14.17 / v0.1.38. Catching up now
keeps "copy verbatim, patch minimally" honest — when SC starts
copying analytics/dividends/ledger pages from
`Scalable-Capital-Dashboard`, the service layer should already be
aligned with the sister apps.

### Not changed

- `js/` — single page (dashboard.js) for now; no shared formatters
  to extract until SC grows multiple pages
- `python/fetch_wrapper.py` — Phase-0 stub still calling sc-api
- App is still v0.0.x — not yet deployed to `cloud.damken.com`

### Verified

`php -l` clean on `BaseOwnCloudService.php`, `ScalableService.php`,
`ApiController.php`. `scripts/verify_dom_ids.py` and
`scripts/verify_wiring.py` both green.

## [0.0.1] — 2026-06-06

Initial scaffold. Verbatim port of `trade-republic-owncloud` with
`tr` → `sc` renames. Phase-0 cookies-only flow; no MFA modal yet
(Scalable's 2FA is push-only, gated by user re-login in Chrome).
