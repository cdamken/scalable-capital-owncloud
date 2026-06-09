#!/bin/bash
# =============================================================================
# Scalable Capital — ownCloud app deploy script
# =============================================================================
# Mirrors Trade-Republic-owncloud/scripts/deploy.sh — same 3-pillar pattern:
#   1. APP   — PHP/JS/CSS/templates → rsync to oc_Apps/, then to server
#   2. LIB   — sc-api Python package → pip install --force-reinstall --no-deps
#   3. CACHE — ?v=<hash> on assets   → bump info.xml version + occ app:enable
#
# Skip ANY one and the deploy silently breaks. See
# TR-GBM-Project/TECHNICAL-PATTERNS.md #9 for the full rationale.
#
# Usage:
#   ./scripts/deploy.sh                       # app + lib, no bump
#   ./scripts/deploy.sh --bump patch          # bump 0.0.x → 0.0.x+1
#   ./scripts/deploy.sh --bump minor          # bump 0.x.y → 0.(x+1).0
#   ./scripts/deploy.sh --bump major          # bump x.y.z → (x+1).0.0
#   ./scripts/deploy.sh --no-lib              # skip pip reinstall
#   ./scripts/deploy.sh --no-app              # skip app rsync
#   ./scripts/deploy.sh --lib --no-app        # library hot-fix only
#   ./scripts/deploy.sh --skip-verify         # skip pre-deploy gates (DON'T)
# =============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="scalable_capital"
SC_API_PATH="${SC_API_PATH:-$PROJECT_DIR/../sc-api}"

# Local staging (where we sync FROM)
LOCAL_OC_APPS="${LOCAL_OC_APPS:-$HOME/damkencloud/oc_Apps}"
LOCAL_STAGE="$LOCAL_OC_APPS/$APP_ID"

# Server (where we sync TO)
# `snoopy5` is the SSH alias to cloud.damken.com:2222 (in ~/.ssh/config).
# (The CLAUDE.md in damkencloud/ still says `go_damken` — that alias was
# renamed at some point. snoopy5 is the live one as of 2026-06.)
REMOTE_HOST="${REMOTE_HOST:-snoopy5}"
REMOTE_APP_DIR="/var/www/owncloud/apps/$APP_ID"
# Standalone Python 3.11 venv. The server is Ubuntu 20.04 with system
# Python 3.8 (too old for sc-api). Carlos compiled 3.11 to /opt/python-3.11/
# and the venv was created with:
#   sudo /opt/python-3.11/bin/python3.11 -m venv /opt/sc-venv
# That's a ONE-TIME setup — see sc-api/CLAUDE.md "First-time server setup".
REMOTE_VENV_DIR="${REMOTE_VENV_DIR:-/opt/sc-venv}"
REMOTE_VENV_PIP="$REMOTE_VENV_DIR/bin/pip"
REMOTE_LIB_STAGE="/opt/sc-api-src"

# Flags
DO_APP=1
DO_LIB=1
DO_VERIFY=1
BUMP=""

while [ $# -gt 0 ]; do
    case "$1" in
        --no-app)      DO_APP=0 ;;
        --no-lib)      DO_LIB=0 ;;
        --lib)         DO_LIB=1 ;;     # explicit; default already on
        --skip-verify) DO_VERIFY=0 ;;
        --bump)        BUMP="$2"; shift ;;
        *) echo "Unknown flag: $1"; exit 2 ;;
    esac
    shift
done

cd "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# Step 0 — pre-deploy gates: verifiers + tests
# ---------------------------------------------------------------------------
if [ "$DO_VERIFY" = "1" ]; then
    echo "🔍 Running pre-deploy verifiers..."
    python3 scripts/verify_dom_ids.py
    python3 scripts/verify_wiring.py
    if [ -d tests ]; then
        python3 -m unittest discover -s tests
    fi
    echo "✅ Verifiers pass"
fi

# ---------------------------------------------------------------------------
# Step 0.5 — bump version (before APP, so info.xml ships with new version)
# ---------------------------------------------------------------------------
bump_version() {
    local mode="$1"
    local current new
    current=$(grep -o '<version>[^<]*</version>' appinfo/info.xml | head -1 | sed 's/[<>]//g; s/version//g')
    IFS='.' read -r maj min pat <<<"$current"
    case "$mode" in
        patch) pat=$((pat + 1)) ;;
        minor) min=$((min + 1)); pat=0 ;;
        major) maj=$((maj + 1)); min=0; pat=0 ;;
        *) echo "Bad bump mode: $mode"; exit 2 ;;
    esac
    new="$maj.$min.$pat"
    sed -i.bak "s|<version>$current</version>|<version>$new</version>|" appinfo/info.xml
    rm -f appinfo/info.xml.bak
    echo "🏷  Version $current → $new"
    APP_VERSION_BUMPED=1
}

if [ -n "$BUMP" ]; then
    bump_version "$BUMP"
fi

# ---------------------------------------------------------------------------
# Step 1 — THE APP
# ---------------------------------------------------------------------------
if [ "$DO_APP" = "1" ]; then
    echo "📦 Syncing app to local stage: $LOCAL_STAGE"
    mkdir -p "$LOCAL_STAGE"
    rsync -a --delete \
        --exclude='.git/' --exclude='.gitignore' \
        --exclude='node_modules/' --exclude='vendor/' \
        --exclude='tests/' --exclude='scripts/' \
        --exclude='.scrapped/' --exclude='*.md' \
        "$PROJECT_DIR/" "$LOCAL_STAGE/"

    echo "🌐 Rsync to server: $REMOTE_HOST:$REMOTE_APP_DIR"
    rsync -a --delete --rsync-path="sudo rsync" \
        "$LOCAL_STAGE/" "$REMOTE_HOST:$REMOTE_APP_DIR/"

    ssh "$REMOTE_HOST" \
        "sudo chown -R www-data:www-data $REMOTE_APP_DIR && \
         sudo -u www-data /var/www/owncloud/occ app:enable $APP_ID && \
         (sudo -u www-data /var/www/owncloud/occ upgrade || true)"
    echo "✅ App deployed"
fi

# ---------------------------------------------------------------------------
# Step 2 — THE LIB (sc-api Python package)
# ---------------------------------------------------------------------------
if [ "$DO_LIB" = "1" ]; then
    if [ ! -d "$SC_API_PATH" ]; then
        echo "⚠️  sc-api not found at $SC_API_PATH — skipping lib step"
    else
        echo "🐍 Syncing sc-api to server staging dir: $REMOTE_LIB_STAGE"
        ssh "$REMOTE_HOST" "sudo mkdir -p $REMOTE_LIB_STAGE && sudo chown \$(whoami) $REMOTE_LIB_STAGE"
        rsync -a --delete \
            --exclude='.git/' --exclude='__pycache__/' --exclude='*.egg-info/' \
            --exclude='.venv/' --exclude='build/' --exclude='dist/' \
            "$SC_API_PATH/" "$REMOTE_HOST:$REMOTE_LIB_STAGE/"

        echo "📥 pip install --upgrade --force-reinstall --no-deps"
        ssh "$REMOTE_HOST" \
            "sudo $REMOTE_VENV_PIP install --upgrade --force-reinstall --no-deps $REMOTE_LIB_STAGE"

        echo "🧪 Smoke import"
        ssh "$REMOTE_HOST" \
            "sudo $REMOTE_VENV_DIR/bin/python -c 'import sc_api; print(\"sc_api\", sc_api.__version__)'"
        echo "✅ Lib deployed"
    fi
fi

# ---------------------------------------------------------------------------
# Step 3 — THE CACHE (already bumped above; occ app:enable already rerun)
# ---------------------------------------------------------------------------
echo ""
echo "🚀 Deploy complete."
echo "   Open: https://cloud.damken.com/index.php/apps/$APP_ID/"
