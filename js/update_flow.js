/* global OC, fmtMoney, fmtPct, fmtQty, postJSON, dataUrl, readRoutes, refreshStaleness, showToast, updateErrorMessage */
/**
 * Shared "⟳ Update Now" flow for Scalable Capital — runs on every page
 * EXCEPT the Portfolio (main), which sets data-update-flow-owner="page" and
 * drives its own Update Now via js/dashboard.js (verbatim from upstream).
 *
 * Scalable uses push-based 2FA (no TOTP code input), so this flow is much
 * simpler than the TR sibling: just POST /api/update, show a toast, refresh
 * the staleness chip, and reload. Per-status error copy lives in
 * updateErrorMessage() (_shared.js), shared with dashboard.js.
 *
 * Patches from OWNCLOUD-PATCHES.md applied here:
 *   #1 URLs read from data-route-* attrs via readRoutes() (in _shared.js)
 *   #2 fetch → postJSON() with requesttoken: OC.requestToken
 *   #3 inline on{click}=triggerUpdate stripped — wired here via addEventListener
 *   #6 toast helper styled by #sc-app CSS in dashboard.css
 *  #10 null-safe wiring via on() (_shared.js)
 */
(function () {
  'use strict';

  if (window.__scUpdateFlowInitialized) return;
  window.__scUpdateFlowInitialized = true;

  function init() {
    const root = document.getElementById('sc-app');
    if (!root) return;
    // Main (Portfolio) handles its own Update Now in dashboard.js — bail early
    // to avoid double-binding the button.
    if (root.dataset.updateFlowOwner === 'page') return;

    const routes = readRoutes();
    if (!routes || !routes.update) return;

    // Initial staleness pull + 60s poll so the chip stays current as the
    // user lingers on a page.
    refreshStaleness(routes);
    setInterval(() => refreshStaleness(routes), 60000);

    const btn = document.getElementById('update-btn');
    if (btn) {
      btn.addEventListener('click', () => triggerUpdate(routes, btn));
    }
  }

  async function triggerUpdate(routes, btn) {
    if (btn) btn.disabled = true;
    showToast('📱 Fetching… if push appears on your phone, tap Approve. This can take up to 2 min.');
    try {
      const res = await postJSON(routes.update);
      const status = res && res.status;
      if (status === 'ok') {
        showToast('Updated ✓', 'ok');
        await refreshStaleness(routes);
        // Reload to re-render the page with fresh JSON. Same UX as upstream
        // (each page's render() is wired to DOMContentLoaded).
        setTimeout(() => location.reload(), 600);
        return;
      }
      // One actionable message per backend status. Keep in sync with
      // ApiController's exit-code map: mfa_invalid (11) is the real push
      // denied/timed-out case; mfa_required (10) is an expired session (or
      // missing credentials). UI copy is English (SC rule).
      showToast(updateErrorMessage(res, status), 'err');
      console.error(res);
    } catch (e) {
      showToast('Update failed: ' + String(e), 'err');
      console.error(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
