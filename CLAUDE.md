# CLAUDE.md — Scalable-Capital-owncloud

> Context for AI assistants. Humans: see [README.md](README.md).
> **MANDATORY reading before any code change:**
> - [`../TR-GBM-Project/OWNCLOUD-PATCHES.md`](../TR-GBM-Project/OWNCLOUD-PATCHES.md) — the 9 allowed patches when porting
> - [`../TR-GBM-Project/TECHNICAL-PATTERNS.md`](../TR-GBM-Project/TECHNICAL-PATTERNS.md) — the 10 reusable patterns
> - [`../TR-GBM-Project/WORKFLOW.md`](../TR-GBM-Project/WORKFLOW.md) — upstream-first, port verbatim
> - [`../TR-GBM-Project/UNIFICATION.md`](../TR-GBM-Project/UNIFICATION.md) — convergence policy

## What this is

ownCloud 10 app that ports `Scalable-Capital-Dashboard` to a multi-user
self-hosted environment. Same role as `trade-republic-owncloud` and
`gbm-owncloud` in their trios.

- **Upstream library:** [`sc-api`](../sc-api/) (Python)
- **Upstream UI:** [`Scalable-Capital-Dashboard`](../Scalable-Capital-Dashboard/)

## Port rules — the 9 allowed patches

When porting from `Scalable-Capital-Dashboard` to this app, apply ONLY these
9 transformations from
[`../TR-GBM-Project/OWNCLOUD-PATCHES.md`](../TR-GBM-Project/OWNCLOUD-PATCHES.md):

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
- **Python venv:** `/var/www/owncloud/apps-venv/scalable_capital/`
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

- **Host:** `cloud.damken.com` via `go_damken` (SSH alias on Carlos's Mac)
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

## Status (2026-06-06)

🚧 **Scaffold only.** Will be populated once `Scalable-Capital-Dashboard`
reaches feature parity worth porting. The skeleton will be copied verbatim
from `trade-republic-owncloud` with names retargeted (`tr` → `sc`,
`trade_republic` → `scalable_capital`, `#tr-app` → `#sc-app`).
