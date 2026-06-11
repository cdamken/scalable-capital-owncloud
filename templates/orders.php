<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Scalable-Capital-Dashboard/app/orders.html body.
 *   - Inline <style> moved to css/dashboard.css (#sc-app .orders-page ...).
 *   - Inline <script> moved to js/orders.js (CSP).
 *   - Inline on{change,input,click} stripped; addEventListener in JS.
 *   - /DATA/transactions.json → routes.data with __TYPE__=transactions.
 *   - /progress → routes.data with __TYPE__=last_update (ts plain in payload).
 *   - /update → routes.update via update_flow.js.
 *   - /export/orders.csv link dropped (not implemented in owncloud port yet).
 */
?>
<div id="sc-app" class="orders-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-orders="<?php p($routes['orders']); ?>"
	data-route-ledger="<?php p($routes['ledger']); ?>"
	data-route-dividends="<?php p($routes['dividends']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-wealth="<?php p($routes['wealth']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-update="<?php p($routes['update']); ?>">

<div id="toast"><span id="toast-msg">…</span></div>

<div class="top-bar">
  <div class="brand"><span class="logo-box"></span> Scalable Capital</div>
  <nav>
    <a class="tab" href="<?php p($routes['index']); ?>">Portfolio</a>
    <a class="tab" href="<?php p($routes['analytics']); ?>">Analytics</a>
    <a class="tab active" href="<?php p($routes['orders']); ?>">📋 Orders</a>
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

<div class="grid">
  <div class="card">
    <div class="label">Trades</div>
    <div class="value" id="kpi-count">—</div>
    <div class="sub" id="kpi-count-sub">in window</div>
  </div>
  <div class="card">
    <div class="label">Total bought</div>
    <div class="value" id="kpi-bought">—</div>
    <div class="sub">€ outflow (BUY)</div>
  </div>
  <div class="card">
    <div class="label">Total sold</div>
    <div class="value" id="kpi-sold">—</div>
    <div class="sub">€ inflow (SELL)</div>
  </div>
  <div class="card">
    <div class="label">Net flow</div>
    <div class="value" id="kpi-net">—</div>
    <div class="sub">sells − buys</div>
  </div>
</div>

<div class="controls">
  <input id="search" type="search" placeholder="Search by ISIN or security name…">
  <select id="side-filter">
    <option value="">All sides</option>
    <option value="BUY">BUY only</option>
    <option value="SELL">SELL only</option>
  </select>
  <select id="status-filter">
    <option value="">All statuses</option>
    <option value="PENDING">Pending</option>
    <option value="FILLED">Filled</option>
    <option value="SETTLED">Settled</option>
    <option value="CONFIRMED">Confirmed</option>
    <option value="CANCELLED">Cancelled</option>
    <option value="EXPIRED">Expired</option>
    <option value="REJECTED">Rejected</option>
  </select>
  <select id="type-filter">
    <option value="">Single + Savings plan</option>
    <option value="SINGLE">Single orders only</option>
    <option value="SAVINGS_PLAN">Savings plan only</option>
  </select>
  <span class="count" id="row-count"></span>
</div>

<table id="orders-table">
  <thead><tr>
    <th>Date</th>
    <th>Security</th>
    <th>ISIN</th>
    <th>Side</th>
    <th>Type</th>
    <th>Quantity</th>
    <th>Amount (€)</th>
    <th>Status</th>
  </tr></thead>
  <tbody>
    <tr><td colspan="8" style="text-align:center; color: var(--muted);">
      Click <em>Update Now</em> to fetch orders.
    </td></tr>
  </tbody>
</table>

</div>
