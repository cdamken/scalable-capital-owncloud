# CLAUDE.md — Scalable-Capital-owncloud

> Context for AI assistants. Humans: see [README.md](README.md).
> **MANDATORY reading before any code change:**
> - [`../Portfolio-Master/OWNCLOUD-PATCHES.md`](../Portfolio-Master/OWNCLOUD-PATCHES.md) — the 9 allowed patches when porting
> - [`../Portfolio-Master/TECHNICAL-PATTERNS.md`](../Portfolio-Master/TECHNICAL-PATTERNS.md) — the 10 reusable patterns
> - [`../Portfolio-Master/WORKFLOW.md`](../Portfolio-Master/WORKFLOW.md) — upstream-first, port verbatim
> - [`../Portfolio-Master/UNIFICATION.md`](../Portfolio-Master/UNIFICATION.md) — convergence policy

## What this is

ownCloud 10 app that ports `Scalable-Capital-Dashboard` to a multi-user
self-hosted environment. Same role as `trade-republic-owncloud` and
`gbm-owncloud` in their trios.

- **Upstream library:** [`sc-api`](../sc-api/) (Python)
- **Upstream UI:** [`Scalable-Capital-Dashboard`](../Scalable-Capital-Dashboard/)

## Port rules — the 9 allowed patches

When porting from `Scalable-Capital-Dashboard` to this app, apply ONLY these
9 transformations from
[`../Portfolio-Master/OWNCLOUD-PATCHES.md`](../Portfolio-Master/OWNCLOUD-PATCHES.md):

1. **URLs hardcoded → `data-route-*` attrs** read from `#sc-app` element
2. **`fetch(...)` → `postJson(...)`** helper with `requesttoken: OC.requestToken`
3. **Inline `on*=` handlers → `addEventListener`** via null-safe `on()` helper
4. **Credentials → `oc_preferences` + `ICrypto`** (encrypted per-user)
5. **Data dir → `{datadir}/<uid>/scalable_capital/`** (per-user isolation)
6. **CSS scoping → `#sc-app .selector`** prefix on every rule
7. **`.htaccess` cache override** (no-cache, must-revalidate on JS/CSS/map)
8. **IIFE wrapper** `(function(){ 'use strict'; ... })();` on every JS file
9. **Tabs/spaces** to match PSR-12 (cosmetic; verifier normalizes)

**Any other divergence is a bug** and goes in `UPSTREAM.md` with stated reason.

## Technical patterns we WILL use (from TECHNICAL-PATTERNS.md)

- **#1 MFA two-step flow** — adapted for push approval (no TOTP code input)
- **#2 Python subprocess wrapper + exit codes** — canonical 0/10/11/12/20/21/30
- **#3 ICrypto for credentials** — email + password encrypted via `OCP\Security\ICrypto`
- **#4 Per-user data directory** — `basename($file)` guard against path traversal
- **#5 Session refresh-token auto-renewal** — push approval only on full session death
- **#6 Toast + thin progress-bar UI** — sync show / sync close (the `submitMfa` shape)
- **#7 Defensive input poll** — NOT NEEDED for Scalable (no TOTP digit input)
- **#8 DOM-id + wiring static verifier** — `scripts/verify_dom_ids.py` + `verify_wiring.py`
  copied from gbm-owncloud
- **#9 deploy.sh "3-pillar"** — app + lib + cache, with pre-deploy gates
- **#10 Null-safe `on()`** — every addEventListener goes through it

## App ID and naming

- **App ID:** `scalable_capital` (underscore, matches `trade_republic` pattern)
- **Root element ID:** `#sc-app`
- **CSS prefix:** `#sc-app .xxx`
- **Python venv:** `/opt/sc-venv/`
- **Deploy path:** `/var/www/owncloud/apps/scalable_capital/`
- **Staging path (Carlos's Mac):** `/Users/carlos/damkencloud/oc_Apps/scalable_capital/`

## Repo layout (mirrors trade-republic-owncloud)

```
appinfo/
├── info.xml              ← appid, version, dependencies
└── routes.php            ← URL routing
lib/
├── AppInfo/Application.php
├── Controller/PageController.php  ← injects data-route-* on #sc-app
├── Controller/ApiController.php   ← /api/update, /api/reset, /api/config, /api/settings
├── Service/ScalableService.php    ← decrypts creds, spawns sc-api subprocess
└── Service/SessionService.php     ← per-user session.json management
templates/
├── main.php              ← Portafolio (port verbatim from Dashboard index)
├── analysis.php
├── orders.php
├── dividends.php
├── ledger.php
├── glossary.php
└── settings.php
js/
├── _shared.js            ← top-bar chrome (verbatim from Dashboard)
├── _update_flow.js       ← MFA modal (push approval variant)
├── dashboard.js          ← Portafolio page logic
└── analysis.js, orders.js, ...
css/
└── scalable.css          ← all scoped to #sc-app
scripts/
├── deploy.sh             ← 3-pillar (verbatim from trade-republic-owncloud, retarget paths)
├── verify_dom_ids.py     ← static verifier
├── verify_wiring.py      ← static verifier
└── verify_upstream_sync.py  ← diff vs Scalable-Capital-Dashboard
.htaccess                 ← no-cache headers for JS/CSS/map
CHANGELOG.md
UPSTREAM.md               ← documented divergences
```

## Deploy workflow

After bumping `<version>` in `appinfo/info.xml`:

1. Run pre-deploy gates: `verify_dom_ids.py`, `verify_wiring.py`, smoke tests.
2. `scripts/deploy.sh --bump patch` (or minor/major).
3. **Chain `occ upgrade` in the SAME ssh command as the rsync** — server
   locks into maintenance mode after a version bump until `occ upgrade`
   runs. See `feedback_occ_upgrade_after_app_bump` in memory.
4. `chown -R www-data:www-data /var/www/owncloud/apps/scalable_capital/`.
5. Ignore the FAKE security advisory banner that `occ upgrade` prints.

## Server access

- **Host:** `cloud.damken.com` via `snoopy5` (SSH alias; was `go_damken`, renamed)
- **Long-running scripts:** always wrap in `nohup ... > log.txt 2>&1 &` —
  see `feedback_nohup_remote_scripts` in memory.
- **Python venv reinstall:** always
  `pip install --upgrade --force-reinstall --no-deps git+https://github.com/cdamken/sc-api.git`
  — see `feedback_pip_force_reinstall_gbm` in memory.

## Security model

| Layer | Mechanism |
|---|---|
| Transport | ownCloud TLS, behind reverse proxy |
| CSRF | `OC.requestToken` on every POST, validated by ownCloud framework |
| Credentials | `oc_preferences` table, encrypted via `ICrypto` |
| Identity | `IUserSession::getUser()->getUID()` only — NEVER from request body |
| Data isolation | `{datadir}/<uid>/scalable_capital/` mode 0700, `basename()` guard |
| Subprocess | `proc_open(array $cmd, ...)` no shell, `HOME=/tmp` sandbox |
| MFA | Push approval triggered on cookie death; not on every fetch |
| Logout-everywhere | Cookie wipe + `~/.sc-api/session.json` removal |

## Status (2026-06-11) — shipped + deployed

✅ **All 8 pages ported and live on `cloud.damken.com`** (v0.0.4,
`scalable_capital` enabled; `/opt/sc-venv` has `sc_api` installed).
Full multi-page port done: 8 templates + 9 JS files + routes +
PageController methods, all from the Dashboard with the 9 allowed
patches.

Conformance (Portfolio-Master `verify_layering.sh`): **7/7** — wrapper
imports `sc_api`, `ScalableService extends BaseOwnCloudService`,
identity from `IUserSession`, credentials in `oc_preferences`+`ICrypto`,
no `shell_exec`, `dataPath()` whitelist, full process gates
(deploy.sh + verify_dom_ids + verify_wiring + tests/ + .htaccess).
Both verifiers + 9 unit tests green.

Auth: push approval, no TOTP code input — the modal-less toast flow in
`js/update_flow.js` ("tap Approve on your phone") is correct and
intentional, NOT a missing feature.

Still pending (not blockers): `.github/workflows/ci.yml` (CI), and the
SC-specific parity items tracked in
[`../Portfolio-Master/UNIFICATION.md`](../Portfolio-Master/UNIFICATION.md)
(yield-on-cost needs a cost-basis field in the sc-api inventory query;
benchmark replay).
