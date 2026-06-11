<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Scalable-Capital-Dashboard/app/dividends.html body.
 * Same patch set as the other pages: CSS to dashboard.css, JS to dividends.js,
 * fetch URLs from data-route-* attrs.
 */
?>
<div id="sc-app" class="dividends-page"
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
    <a class="tab active" href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
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
    <div class="label">Total received</div>
    <div class="value" id="kpi-total">—</div>
    <div class="sub">All-time distributions (in window)</div>
  </div>
  <div class="card">
    <div class="label">This year</div>
    <div class="value" id="kpi-ytd">—</div>
    <div class="sub" id="kpi-ytd-year">YTD</div>
  </div>
  <div class="card">
    <div class="label">Payments</div>
    <div class="value" id="kpi-count" style="color: var(--text);">—</div>
    <div class="sub" id="kpi-securities">— securities</div>
  </div>
  <div class="card">
    <div class="label">Avg / payment</div>
    <div class="value" id="kpi-avg" style="color: var(--text);">—</div>
    <div class="sub">arithmetic mean</div>
  </div>
</div>

<div class="forecast" id="forecast-box" style="display: none;">
  <div class="label">Forward dividend forecast (next 12 months)</div>
  <div class="value" id="forecast-value">—</div>
  <div class="sub" id="forecast-sub">based on the last 12 months of distributions</div>
</div>

<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
  <h2 style="margin: 0;">By year</h2>
</div>
<div class="chart-wrap">
  <svg id="year-chart" viewBox="0 0 600 280" preserveAspectRatio="none"></svg>
</div>

<h2>By security</h2>
<table id="by-security-table">
  <thead><tr>
    <th>Security</th>
    <th>ISIN</th>
    <th>Payments</th>
    <th>Last payment</th>
    <th>Total received</th>
  </tr></thead>
  <tbody>
    <tr><td colspan="5" style="text-align:center; color: var(--muted);">
      Click <em>Update Now</em> to load distributions.
    </td></tr>
  </tbody>
</table>

<h2 style="margin-top: 32px;">All distributions</h2>
<table id="all-table">
  <thead><tr>
    <th>Date</th>
    <th>Security</th>
    <th>ISIN</th>
    <th>Description</th>
    <th>Amount</th>
  </tr></thead>
  <tbody>
    <tr><td colspan="5" style="text-align:center; color: var(--muted);">—</td></tr>
  </tbody>
</table>

</div>
