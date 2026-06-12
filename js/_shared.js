/* global OC */
/**
 * Shared helpers for all Scalable Capital ownCloud pages.
 *
 * Loaded by PageController before every per-page script. The names match
 * what the upstream Scalable-Capital-Dashboard pages declared inline in
 * their <script> blocks; the only difference is they're module-level
 * functions here (no IIFE) so per-page scripts can reference them at
 * parse time.
 *
 * The 9 mechanical patches (OWNCLOUD-PATCHES.md) are applied via:
 *   - postJSON() — wraps fetch with requesttoken: OC.requestToken (#3 CSRF)
 *   - on(id, evt, fn) — null-safe addEventListener (#10 + technical pattern)
 *   - setStaleness() reads /data/last_update (a plain ISO string) instead
 *     of /progress.
 */

const fmtMoney = (n, currency = 'EUR') => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
};

const fmtMoneySigned = (n, currency = 'EUR', signed = false) => {
  if (n == null || isNaN(n)) return '—';
  const s = new Intl.NumberFormat('en-US', {
    style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(n));
  if (!signed) return n < 0 ? '−' + s : s;
  return (n > 0 ? '+' : n < 0 ? '−' : '') + s;
};

const fmtPct = (n, opts = {}) => {
  if (n == null || isNaN(n)) return '—';
  const decimals = opts.decimals ?? 2;
  const v = (n * 100).toFixed(decimals);
  return (n >= 0 ? '+' : '') + v + '%';
};

const fmtQty = (n) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n);
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB',
    { year: 'numeric', month: 'short', day: '2-digit' });
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

// Null-safe addEventListener — works with either an id string or a CSS
// selector. Mirrors OWNCLOUD-PATCHES.md #3 + TECHNICAL-PATTERNS.md #10.
function on(target, evt, fn) {
  let el = null;
  if (typeof target === 'string') {
    el = document.getElementById(target);
    if (!el) el = document.querySelector(target);
  } else {
    el = target;
  }
  if (el) el.addEventListener(evt, fn);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) return null;
  return res.json();
}

// All POSTs need requesttoken: OC.requestToken (CSRF). Owncloud rejects
// the request with 412 otherwise.
async function postJSON(url, body = {}) {
  // Guard against a missing route. Without this, fetch(undefined) coerces
  // to the string "undefined" and POSTs to <base>/undefined → 302 → HTML
  // → "invalid response". That was the real cause of the failing Update
  // (a stale cached build read routes.update as undefined). Fail loud.
  if (!url || typeof url !== 'string') {
    return {
      status: 'error',
      detail: 'route not configured — hard-refresh the page (Cmd+Shift+R) to load the latest scripts',
    };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'requesttoken': (typeof OC !== 'undefined' && OC.requestToken) ? OC.requestToken : '',
    },
    body: JSON.stringify(body || {}),
  });
  // Read the raw body once, then try to parse. If parsing fails, surface
  // the HTTP status + a snippet of the body so "invalid response" stops
  // hiding the real cause (a 500 HTML page, a proxy 504, an empty body…).
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch (e) {
    const snippet = (raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return {
      status: 'error',
      detail: `HTTP ${res.status} non-JSON: ${snippet || '(empty body)'}`,
    };
  }
}

// Read the routes hash off the #sc-app element. Every template injects these
// data-route-* attrs from PageController; per-page JS calls this once at init.
function readRoutes() {
  const app = document.getElementById('sc-app');
  if (!app) return {};
  return {
    index:     app.dataset.routeIndex,
    settings:  app.dataset.routeSettings,
    orders:    app.dataset.routeOrders,
    ledger:    app.dataset.routeLedger,
    dividends: app.dataset.routeDividends,
    analytics: app.dataset.routeAnalytics,
    wealth:    app.dataset.routeWealth,
    glossary:  app.dataset.routeGlossary,
    data:      app.dataset.routeData,
    config:    app.dataset.routeConfig,
    setConfig: app.dataset.routeSetConfig,
    update:    app.dataset.routeUpdate,
    reset:     app.dataset.routeReset,
  };
}

// Returns the URL for a given JSON data type, substituting the '__TYPE__'
// placeholder that PageController injected into routes.data.
function dataUrl(routes, type) {
  return (routes.data || '').replace('__TYPE__', type);
}

// Stalenes chip — common across all pages. ts is either an ISO string with
// 'Z' (new format) or 'YYYY-MM-DD HH:MM:SS' local (legacy).
function setStaleness(ts) {
  const el = document.getElementById('staleness');
  if (!el) return;
  if (!ts) {
    el.textContent = 'never updated';
    el.className = 'staleness';
    return;
  }
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  const ageMin = (Date.now() - d.getTime()) / 60000;
  let cls = 'fresh';
  let label = Math.round(ageMin) + 'm ago';
  if (ageMin > 60)   { cls = 'warn';  label = Math.round(ageMin / 60) + 'h ago'; }
  if (ageMin > 1440) { cls = 'stale'; label = Math.round(ageMin / 1440) + 'd ago'; }
  el.textContent = 'Updated ' + label;
  el.className = 'staleness ' + cls;
}

// Read last_update from /data/last_update and feed it to setStaleness().
// last_update.json payload shape from sc-api is either { last_update: "..." }
// or a plain string — both handled.
async function refreshStaleness(routes) {
  try {
    const r = await fetch(dataUrl(routes, 'last_update') + '?t=' + Date.now());
    if (!r.ok) return;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    let ts = null;
    if (ct.includes('application/json')) {
      const body = await r.json();
      if (body && typeof body === 'object') {
        ts = body.last_update || body.ts || body.date || null;
      } else if (typeof body === 'string') {
        ts = body;
      }
    } else {
      ts = (await r.text()).trim();
    }
    setStaleness(ts);
  } catch (_) { /* keep prior state on error */ }
}

// Simple toast helper used by per-page scripts. Same DOM shape used by the
// upstream Dashboard: #toast (container) with #toast-msg (span). The
// triggerUpdate flow on each page just calls this directly.
function showToast(message, kind = '') {
  const t = document.getElementById('toast');
  const msg = document.getElementById('toast-msg');
  if (!t || !msg) return;
  t.className = 'active ' + kind;
  msg.textContent = message;
  if (kind === 'ok') {
    setTimeout(() => t.classList.remove('active'), 2500);
  }
}
