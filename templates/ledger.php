<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Scalable-Capital-Dashboard/app/ledger.html body.
 * Patches identical to orders.php: CSS to dashboard.css, JS to ledger.js,
 * fetch URLs through data-route-data.
 */
?>
<div id="sc-app" class="ledger-page"
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
    <a class="tab" href="<?php p($routes['orders']); ?>">📋 Orders</a>
    <a class="tab" href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
    <a class="tab active" href="<?php p($routes['ledger']); ?>">📒 Ledger</a>
    <a class="tab" href="<?php p($routes['wealth']); ?>">🏦 Wealth</a>
    <a class="tab" href="<?php p($routes['glossary']); ?>">📖 Glossary</a>
    <a class="tab" href="<?php p($routes['settings']); ?>">⚙ Settings</a>
  </nav>
  <div class="actions">
    <span id="staleness" class="staleness">never updated</span>
    <button id="update-btn" class="btn btn-primary">⟳ Update Now</button>
  </div>
</div>

<div class="grid grid-5">
  <div class="card">
    <div class="label">Money in</div>
    <div class="value pos" id="kpi-in">—</div>
    <div class="sub">Deposits + tax returns + interest</div>
  </div>
  <div class="card">
    <div class="label">Money out</div>
    <div class="value neg" id="kpi-out">—</div>
    <div class="sub">Withdrawals + fees + taxes</div>
  </div>
  <div class="card">
    <div class="label">Distributions</div>
    <div class="value pos" id="kpi-distrib">—</div>
    <div class="sub" id="kpi-distrib-count">— payments</div>
  </div>
  <div class="card">
    <div class="label">Net cashflow</div>
    <div class="value" id="kpi-net">—</div>
    <div class="sub">in − out + distributions</div>
  </div>
  <div class="card">
    <div class="label">Entries</div>
    <div class="value" id="kpi-count">—</div>
    <div class="sub" id="kpi-count-sub">in current filter</div>
  </div>
</div>

<div class="controls">
  <input id="search" type="search" placeholder="Search description or ISIN…">
  <select id="type-filter">
    <option value="">All types</option>
    <option value="DEPOSIT">Deposit</option>
    <option value="WITHDRAWAL">Withdrawal</option>
    <option value="DISTRIBUTION">Distribution (dividends)</option>
    <option value="INTEREST">Interest</option>
    <option value="TAX">Tax</option>
    <option value="TAX_RETURN">Tax return</option>
    <option value="FEE">Fee</option>
  </select>
  <span class="count" id="row-count"></span>
</div>

<table id="ledger-table">
  <thead><tr>
    <th>Date</th>
    <th>Type</th>
    <th>Description</th>
    <th>ISIN</th>
    <th>Amount</th>
    <th>Status</th>
  </tr></thead>
  <tbody>
    <tr><td colspan="6" style="text-align:center; color: var(--muted);">
      Click <em>Update Now</em> to load cash movements.
    </td></tr>
  </tbody>
</table>

</div>
