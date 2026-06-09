# Scalable Capital ownCloud — installation

## Prerequisites

- ownCloud 10 (any patch). Tested on the version `cloud.damken.com` runs.
- **Python 3.10+** with the `sc-api` package installed.
  - `cloud.damken.com` (Ubuntu 20.04) only ships Python 3.8.10 in the system,
    which is too old. Carlos already compiled Python 3.11.15 to
    `/opt/python-3.11/` — use that.
- PHP 7+ (whatever your ownCloud install needs)
- `ssh` access as a sudo-capable user (alias `snoopy5` in Carlos's
  `~/.ssh/config`, hostname `cloud.damken.com` port 2222)

## One-time server setup

### 1. Create the Python venv

```bash
ssh snoopy5
sudo /opt/python-3.11/bin/python3.11 -m venv /opt/sc-venv
sudo /opt/sc-venv/bin/pip install --upgrade pip
```

Then install `sc-api` into it. Two options:

**(a) From GitHub (recommended once the repo is public):**
```bash
sudo /opt/sc-venv/bin/pip install \
    "sc-api @ git+https://github.com/cdamken/sc-api.git"
```

**(b) From a local rsync staging dir** (what `deploy.sh --lib` does):
```bash
sudo mkdir -p /opt/sc-api-src
sudo chown $(whoami) /opt/sc-api-src
# from your laptop:
rsync -a --delete --exclude='.git/' --exclude='__pycache__/' \
    /Users/carlos/damkencloud/Claude/sc-api/ snoopy5:/opt/sc-api-src/
ssh snoopy5
sudo /opt/sc-venv/bin/pip install --upgrade --force-reinstall --no-deps /opt/sc-api-src
```

Smoke test:
```bash
sudo /opt/sc-venv/bin/python -c "import sc_api; print(sc_api.__version__)"
# → sc-api 0.0.1
```

### 2. Cookies onboarding (per ownCloud user)

`sc-api` reads Scalable session cookies via `pycookiecheat` from a local
Chrome. **That doesn't work on a headless server.** The model for ownCloud
is therefore "user imports cookies on their own machine, uploads
cookies.txt to ownCloud."

The upload UI is on the BACKLOG. For Phase 0 (you, Carlos), the manual
process:

```bash
# On your Mac:
cd /Users/carlos/damkencloud/Claude/sc-api
.venv/bin/sc-api auth import --email carlos@damken.com --set-active
.venv/bin/sc-api auth discover

# Upload the resulting cookie jar to the server's per-user data dir:
scp ~/.sc-api/profiles/carlos@damken.com/cookies.txt \
    snoopy5:/tmp/sc-cookies.txt
ssh snoopy5 'sudo mkdir -p /var/lib/owncloud/data/<your-uid>/scalable_capital \
  && sudo mv /tmp/sc-cookies.txt /var/lib/owncloud/data/<your-uid>/scalable_capital/cookies.txt \
  && sudo chown www-data:www-data /var/lib/owncloud/data/<your-uid>/scalable_capital/cookies.txt \
  && sudo chmod 600 /var/lib/owncloud/data/<your-uid>/scalable_capital/cookies.txt'

# (Replace /var/lib/owncloud/data/ with your `datadirectory` from config.php)
```

Re-upload every 8 hours (the cookie's TTL — see protocol.md §2.5) or
whenever the dashboard shows "Cookies expired."

### 3. Deploy the app

```bash
cd /Users/carlos/damkencloud/Claude/Scalable-Capital-owncloud
./scripts/deploy.sh --bump patch
```

The script does the 3-pillar deploy (app + lib + cache bump) — see
`TR-GBM-Project/TECHNICAL-PATTERNS.md` #9 for the rationale.

### 4. Enable the app in ownCloud

```bash
ssh snoopy5
sudo -u www-data /var/www/owncloud/occ app:enable scalable_capital
sudo -u www-data /var/www/owncloud/occ upgrade  # if appinfo/info.xml version bumped
```

Open `https://cloud.damken.com/index.php/apps/scalable_capital/` —
should show the Portafolio page.

## Troubleshooting

- **"sc-api: command not found"** — your `/opt/sc-venv/` is missing or broken.
  Recreate: `sudo /opt/python-3.11/bin/python3.11 -m venv /opt/sc-venv`.
- **`ImportError: sc_api`** in fetch.log — the lib step of deploy didn't run.
  Re-run `./scripts/deploy.sh --lib --no-app`.
- **HTTP 500 on the app page** — usually `chown` missed.
  `ssh snoopy5 'sudo chown -R www-data:www-data /var/www/owncloud/apps/scalable_capital'`.
- **"mfa_required" on Update** — your cookies expired. Re-run the cookies
  upload (step 2).
- **"No portfolioId found in cockpit HTML"** — your Scalable session is alive
  but the cockpit page shape changed. Open an issue with a redacted HAR.
