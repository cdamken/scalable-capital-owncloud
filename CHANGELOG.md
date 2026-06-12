# Changelog

Notable changes to `scalable-capital-owncloud`. Format follows
[Keep a Changelog](https://keepachangelog.com/) and the version follows
[SemVer](https://semver.org/).

## [0.0.12] — 2026-06-12

Correction to 0.0.10/0.0.11: the original report was about the **chart**,
not the KPI. The top "TWR" card is the **general / since-inception** figure
and must NOT change with the range pills (it stays at e.g. +25.04%). Only
the chart (curve endpoint) and its "Window return" label change per period.

- Reverted the KPI card to the cumulative-since-inception value
  (`timeWeightedReturnHistory.slice(-1)`); restored label "TWR since start".
- Removed `renderKPIs()` from the range-pill handler (the headline figure
  is range-independent again).
- Kept the chart fix from 0.0.11: the curve is rebased to the window start,
  so its endpoint shows the per-period return and the "Window return" label
  matches it.

## [0.0.13] — 2026-06-12

Chart quality: migrate the **Wealth** charts from hand-rolled SVG to
**Chart.js** (v4.5.1, vendored — same engine as TR/GBM), so SC stops being
the odd-one-out with thin, basic SVG lines. New shared `js/charts.js`
(self-contained, byte-identical to the Dashboard's `app/charts.js`) carries
the polished styling ported from `Trade-Republic-owncloud` (gradient area
fills, smooth tension, hover tooltips, subtle axes).

- TWR chart + Portfolio-value-vs-capital chart now render via Chart.js.
- `<svg>` → `<canvas>` in `templates/wealth.php`; PageController loads
  `vendor/chart.umd.min` + `charts` on the analytics + wealth pages.
- `renderLineChart` / `renderTwoLineChart` moved out of `wealth.js` into the
  shared helper; call sites unchanged. Behaviour from 0.0.12 preserved
  (KPI = since-inception TWR; chart rebased per window).

Analytics-page charts + the S&P500/MSCI World/Nasdaq benchmark replay land
in follow-up versions.

## [0.0.11] — 2026-06-12

Follow-up to 0.0.10: the TWR **chart curve** still plotted raw cumulative
TWR, so its endpoint always showed the same since-inception figure
(e.g. +25.04%) for every range even though the KPI + "Window return" were
correct. Rebase the plotted series to the window start
(`(1 + cum) / (1 + cumAtStart) − 1`) so the line begins at 0% and ends at
the window return — chart, KPI and header now agree. (Ported from
Scalable-Capital-Dashboard.)

## [0.0.10] — 2026-06-12

**Wealth TWR was identical for every range (1M/3M/6M/…).** The TWR KPI read
`timeWeightedReturnHistory.slice(-1)` — the cumulative-since-inception value —
regardless of the selected period, and never re-rendered when the period
changed. The chart's "Change in window" used an arithmetic `last − first` of
cumulative TWR (percentage *points*), which also didn't match a true return.

### Fix (ported from Scalable-Capital-Dashboard, upstream-first)

- TWR is cumulative since inception, so a window's return must be **rebased
  geometrically**: `(1 + cumAtEnd) / (1 + cumAtStart) − 1`. Added
  `sliceTwrByRange()` + `windowedTwr()` helpers.
- `renderKPIs()` now shows the windowed TWR for the active range and the sub
  label reflects it ("time-weighted · last month" / "· since start"). KPI label
  changed from "TWR since start" → "TWR".
- `renderKPIs()` is now called from the range-pill handler (was missing).
- The TWR chart info line now shows "Window return: +X%" (the same rebased
  figure as the KPI, so the two never disagree) instead of "Change … pp".

## [0.0.9] — 2026-06-12

**The actual root cause of every failed Update.** `dashboard.js` (the
Portafolio page) read `const routes = readRoutes()` at module-parse time.
ownCloud injects app scripts in `<head>`, so when that line ran the
`<body>` — and the `#sc-app` element that carries the `data-route-*`
attrs — did not exist yet. `getElementById('sc-app')` returned null,
`readRoutes()` returned `{}`, and **every route was undefined**. That is
why clicking Update from the Portafolio page POSTed to `/undefined`
(then, with v0.0.8's guard, showed "route not configured"), and why
`render()`'s `getJSON(routes.config)` quietly hit `GET /undefined`.

Every other page worked because `update_flow.js` and `orders.js` call
`readRoutes()` *inside* `init()` (on DOMContentLoaded). `dashboard.js`
was the only per-page script that read routes eagerly — a port bug; the
gbm/TR `dashboard.js` both use the correct `let routes;` + populate-in-
DOMContentLoaded pattern.

### Fix

- `dashboard.js`: `const routes = readRoutes()` → `let routes = {}` at
  module scope, populated via `routes = readRoutes()` at the top of
  `init()`. Now matches the rest of the trio.

The whole cache saga sat on top of this: the deploy bump bug (v0.0.8)
kept the `?v=` hash pinned, so the browser never refetched the
already-broken `dashboard.js` to even reveal the timing bug.

## [0.0.8] — 2026-06-12

Observability pass — "make everything show up in the logs." The Update
button had been failing with cryptic, near-useless messages ("invalid
response", then raw `<!DOCTYPE html>` soup) because nothing on the server
side recorded what actually happened. Three layers fixed:

### What changed

- **`ApiController::update()` never returns HTML.** Wrapped in
  `try/catch (\Throwable)` so an unexpected error is logged via
  `logException` and returned as JSON (`{status:'error', detail:...}`)
  instead of bubbling into a 500 HTML page the JS can't parse. Adds
  `exitCode` to the payload and a non-empty fallback `detail`.
- **`BaseOwnCloudService::runProcess()` logs to `owncloud.log`** (tagged
  with the app id) — a start line with the exact argv (secrets travel via
  env, never argv) and a one-line summary on completion: `exit=N (NAME)
  duration=Xms | <last stderr line>`. Level scales with severity
  (OK→info, MFA→warning, else→error). `fetch.log` header is now greppable
  and self-summarising (exit name, duration, command, last error).
- **`postJSON()` translates session/stale-page failures** into one
  actionable sentence ("Your ownCloud session expired… reload with
  Cmd+Shift+R, sign in again, then retry") instead of dumping the
  ownCloud HTML shell. Detects HTML bodies + 401/403/412 + login
  redirects.
- **`fetch_wrapper.py`** prefixes every line with a UTC timestamp and
  emits a `start:` banner (email, full flag, cookie presence, creds
  presence) so the stderr section of `fetch.log` reads as a timeline.

Vendored-triplet note: the `BaseOwnCloudService` logging additions port
verbatim to `gbm-owncloud` and `Trade-Republic-owncloud`.

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
