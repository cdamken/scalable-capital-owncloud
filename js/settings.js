/* global OC, postJSON, getJSON, on, readRoutes, dataUrl, showToast */
/**
 * Settings page — verbatim port of Scalable-Capital-Dashboard/app/settings.html
 * script block.
 *
 * Patches from OWNCLOUD-PATCHES.md:
 *   - POST /save_credentials → routes.setConfig (POST /api/config)
 *   - POST /reset → routes.reset
 *   - GET /setup_status → routes.config (returns { configured, email, ... })
 *   - GET /DATA/wealth.json → dataUrl(routes, 'wealth')
 *   - POST /logout, POST /check_session, GET /version: not exposed in the
 *     owncloud port. Buttons stay for UX parity; clicks show a friendly
 *     "not available" toast rather than 404ing.
 */
(function () {
  'use strict';

  function setStatus(id, text, kind = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'status-msg ' + (kind || '');
  }

  let routes;

  async function refreshAccountSummary() {
    const status = await getJSON(routes.config);
    const summary = document.getElementById('acc-summary');
    const loginHeading = document.getElementById('login-heading');
    if (status && status.configured) {
      if (summary) summary.style.display = 'block';
      document.getElementById('acc-email').textContent = status.email || '—';
      document.getElementById('acc-userid').textContent = status.user_id || '—';
      document.getElementById('acc-broker').textContent =
        status.portfolio_ids ? (status.portfolio_ids.length + ' configured') : '—';
      const wealth = await getJSON(dataUrl(routes, 'wealth'));
      document.getElementById('acc-wealth').textContent =
        Array.isArray(wealth)
          ? (wealth.length + ' (' + wealth.filter(w => w.invested !== false).length + ' active)')
          : '—';
      if (loginHeading) loginHeading.textContent = 'Switch account / re-save credentials';
    } else {
      if (summary) summary.style.display = 'none';
      if (loginHeading) loginHeading.textContent = 'Save Scalable credentials';
    }
  }

  async function submitLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) {
      setStatus('login-status', 'Email and password required', 'err');
      return;
    }
    const btn = document.getElementById('login-btn');
    if (btn) btn.disabled = true;
    setStatus('login-status', 'Saving…');
    try {
      const res = await postJSON(routes.setConfig, { email, password });
      if (res && res.status === 'ok') {
        setStatus('login-status', '✓ Credentials saved', 'ok');
        document.getElementById('login-password').value = '';
        showToast('Credentials saved — click Update Now on any page to trigger push approval.', 'ok');
        await refreshAccountSummary();
      } else {
        const msg = (res && (res.detail || res.error)) || ('Error: ' + (res && res.status));
        setStatus('login-status', msg, 'err');
        showToast(msg, 'err');
        console.error(res);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function logout() {
    if (!confirm("Log out and delete cookies + local profile? You'll need to log in again with email + password + push.")) return;
    // /logout endpoint is not exposed in the ownCloud port — wipe via the
    // reset endpoint, which clears credentials + session.
    const res = await postJSON(routes.reset, { wipe_credentials: true });
    if (res && res.status === 'ok') {
      showToast('Logged out', 'ok');
      await refreshAccountSummary();
    } else {
      showToast('Logout failed', 'err');
    }
  }

  async function checkSession() {
    setStatus('session-status', 'Testing…');
    // /check_session is not exposed; fall back to /api/config which returns
    // { configured: bool, email, ... }. Configured = credentials are present;
    // actual cookie freshness can only be probed via Update Now.
    const status = await getJSON(routes.config);
    if (status && status.configured) {
      setStatus('session-status', '✓ Credentials present — actual cookie freshness only verifiable via Update Now.', 'ok');
    } else {
      setStatus('session-status', '✗ No credentials — save them above first.', 'err');
    }
  }

  async function clearData() {
    if (!confirm('Delete all downloaded JSONs? (does not affect cookies)')) return;
    const res = await postJSON(routes.reset, { wipe_data_only: true });
    if (res && res.status === 'ok') {
      setStatus('clear-status', '✓ Local data cleared', 'ok');
      showToast('Local data cleared', 'ok');
    } else {
      setStatus('clear-status', '✗ failed', 'err');
    }
  }

  async function loadAbout() {
    // /version endpoint not exposed — show a sentinel string. The actual
    // sc-api version lives inside the per-user venv on the server; not
    // wired through to the UI yet.
    const el = document.getElementById('about-sc-version');
    if (el) el.textContent = 'see server-side /opt/sc-venv/';
  }

  function trackSidebar() {
    const sections = ['account', 'session', 'data', 'about'];
    function onScroll() {
      let active = sections[0];
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < 200) active = id;
      }
      document.querySelectorAll('.settings-side a').forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === '#' + active);
      });
    }
    window.addEventListener('scroll', onScroll);
  }

  function init() {
    if (!document.getElementById('sc-app')) return;
    routes = readRoutes();
    on('login-form', 'submit', submitLogin);
    on('logout-btn', 'click', logout);
    on('check-session-btn', 'click', checkSession);
    on('clear-data-btn', 'click', clearData);
    refreshAccountSummary();
    loadAbout();
    trackSidebar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
