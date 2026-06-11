<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Scalable-Capital-Dashboard/app/index.html body.
 *   1. Wrapped in <div id="sc-app" data-update-flow-owner="page" data-route-*=...>.
 *   2. Inline <style> migrated to css/dashboard.css (every selector prefixed #sc-app).
 *   3. Inline <script> moved into js/dashboard.js (ownCloud CSP blocks inline scripts).
 *   4. Inline on* handlers stripped; wired via addEventListener in dashboard.js.
 *   5. Hardcoded fetch URLs ('/setup_status','/progress','/DATA/*.json','/update') replaced
 *      by data-route-* values + routes.data.replace('__TYPE__', name).
 *   6. The Update Now button drives dashboard.js's own triggerUpdate (data-update-flow-owner=page),
 *      so update_flow.js stays out of the way.
 *   7. Settings tab points at the new owncloud /settings route (was a static link to settings.html).
 */
?>
<div id="sc-app"
	data-update-flow-owner="page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-orders="<?php p($routes['orders']); ?>"
	data-route-ledger="<?php p($routes['ledger']); ?>"
	data-route-dividends="<?php p($routes['dividends']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-wealth="<?php p($routes['wealth']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-config="<?php p($routes['config']); ?>"
	data-route-set-config="<?php p($routes['setConfig']); ?>"
	data-route-update="<?php p($routes['update']); ?>"
	data-route-reset="<?php p($routes['reset']); ?>">

<div class="top-bar">
  <div class="brand"><span class="logo-box"></span> Scalable Capital</div>
  <nav>
    <a class="tab active" href="<?php p($routes['index']); ?>">Portfolio</a>
    <a class="tab" href="<?php p($routes['analytics']); ?>">Analytics</a>
    <a class="tab" href="<?php p($routes['orders']); ?>">📋 Orders</a>
    <a class="tab" href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
    <a class="tab" href="<?php p($routes['ledger']); ?>">📒 Ledger</a>
    <a class="tab" href="<?php p($routes['wealth']); ?>">🏦 Wealth</a>
    <a class="tab" href="<?php p($routes['glossary']); ?>">📖 Glossary</a>
    <a class="tab" href="<?php p($routes['settings']); ?>">⚙ Settings</a>
  </nav>
  <div class="actions">
    <span id="staleness" class="staleness">never updated</span>
    <button id="update-btn" class="btn btn-primary">⟳ Update Now</button>
  </div>
</div>

<div id="setup-state" style="display: none;">
  <div class="empty-state">
    <h2>👋 No account configured</h2>
    <p style="margin: 10px 0 20px;">Register your Scalable account before fetching data.</p>
    <a href="<?php p($routes['settings']); ?>" class="btn btn-primary" style="text-decoration: none; display: inline-block; padding: 12px 24px;">
      Go to Settings →
    </a>
    <p style="margin-top: 20px; font-size: 12px; color: var(--muted);">
      You'll enter email + password, approve the push once, and the dashboard loads.
    </p>
  </div>
</div>

<div id="dashboard-state" style="display: none;">
  <div class="grid">
    <div class="card"><div class="label">Total (Broker + Wealth)</div><div class="value" id="kpi-total">—</div></div>
    <div class="card"><div class="label">Broker · Cash</div><div class="value" id="kpi-cash">—</div></div>
    <div class="card"><div class="label">Broker · Securities</div><div class="value" id="kpi-securities">—</div></div>
    <div class="card"><div class="label">Wealth · Total</div><div class="value" id="kpi-wealth">—</div></div>
  </div>

  <h2 style="margin-top: 32px; font-size: 18px;">Wealth (Roboadvisor)</h2>
  <table id="wealth-table">
    <thead><tr>
      <th>Name</th><th>Type</th><th>Risk</th>
      <th>Funded</th><th>Status</th><th>Valuation</th>
    </tr></thead>
    <tbody><tr><td colspan="6" style="text-align:center; color: var(--muted);">
      No wealth portfolios yet.
    </td></tr></tbody>
  </table>

  <h2 style="margin-top: 32px; font-size: 18px;">Broker · Holdings
    <span style="color: var(--muted); font-size: 12px; font-weight: 400;" id="broker-pending-label"></span>
  </h2>

  <div id="concentration-warnings"></div>

  <div class="controls">
    <input id="holdings-search" type="search" placeholder="Search by name or ISIN…">
    <span class="count" id="holdings-count"></span>
  </div>

  <table id="holdings-table">
    <thead><tr>
      <th class="sortable" data-sort="name">Name</th>
      <th class="sortable" data-sort="isin">ISIN</th>
      <th class="sortable" data-sort="qty">Position</th>
      <th class="sortable" data-sort="price">Price</th>
      <th class="sortable sort-desc" data-sort="value">Value</th>
      <th class="sortable" data-sort="pnl">P&amp;L %</th>
    </tr></thead>
    <tbody><tr><td colspan="6" style="text-align:center; color: var(--muted);">
      Click <em>Update Now</em> to fetch your portfolio.
    </td></tr></tbody>
  </table>
</div>

<div id="position-modal" class="modal-backdrop">
  <div class="modal">
    <button class="modal-close" id="modal-close-btn">✕ Close</button>
    <h3 id="modal-name">—</h3>
    <div class="modal-sub" id="modal-isin">—</div>
    <dl id="modal-body"></dl>
  </div>
</div>

<div id="toast"><span id="toast-msg">…</span></div>

</div>
