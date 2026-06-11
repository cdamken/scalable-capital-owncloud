<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Scalable-Capital-Dashboard/app/analytics.html body.
 */
?>
<div id="sc-app" class="analytics-page"
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
    <a class="tab active" href="<?php p($routes['analytics']); ?>">Analytics</a>
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

<div class="grid">
  <div class="card">
    <div class="label">XIRR (annualised)</div>
    <div class="value" id="kpi-xirr">—</div>
    <div class="sub">cash-flow weighted return</div>
  </div>
  <div class="card">
    <div class="label">Lifetime P&amp;L</div>
    <div class="value" id="kpi-lifetime">—</div>
    <div class="sub" id="kpi-lifetime-sub">value − net capital in</div>
  </div>
  <div class="card">
    <div class="label">Net capital committed</div>
    <div class="value" id="kpi-net-capital" style="color: var(--text);">—</div>
    <div class="sub">deposits − withdrawals</div>
  </div>
  <div class="card">
    <div class="label">Total distributions</div>
    <div class="value pos" id="kpi-distributions">—</div>
    <div class="sub" id="kpi-distrib-count">— received</div>
  </div>
  <div class="card" title="Forward 12-month dividend ÷ FIFO cost basis. Unlike market yield (÷ current price), this is the income you earn per euro you actually paid. Parity with the TR dashboard.">
    <div class="label">Yield on cost</div>
    <div class="value" id="kpi-yoc" style="color: var(--blue);">—</div>
    <div class="sub" id="kpi-yoc-sub">forward 12m ÷ cost basis</div>
  </div>
</div>

<h2>Time-weighted return (Broker)</h2>
<div class="chart-wrap">
  <table class="twr-table">
    <thead><tr>
      <th>Timeframe</th><th>Performance</th><th>Absolute return</th>
    </tr></thead>
    <tbody id="twr-tbody">
      <tr><td colspan="3" style="text-align:center; color: var(--muted);">No data yet.</td></tr>
    </tbody>
  </table>
</div>

<div class="two-col">
  <div>
    <h2>Allocation (Broker holdings)</h2>
    <div class="chart-wrap">
      <div class="ring-chart">
        <svg id="ring-chart" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="legend" id="ring-legend"></div>
      </div>
    </div>
  </div>
  <div>
    <h2>Dividends per year</h2>
    <div class="chart-wrap">
      <svg id="dividends-chart" viewBox="0 0 600 280" preserveAspectRatio="none" style="width:100%; height: 240px; display:block;"></svg>
    </div>
  </div>
</div>

<h2>Geographic allocation</h2>
<div class="chart-wrap">
  <p style="color: var(--muted); font-size: 12px; margin: 0 0 8px;" id="geo-substat">
    By the country prefix in each ISIN — not by where the company earns its revenue.
  </p>
  <svg id="geo-chart" viewBox="0 0 600 280" preserveAspectRatio="none" style="width:100%; height: 240px; display:block;"></svg>
</div>

<h2>Net capital committed over time</h2>
<div class="chart-wrap">
  <svg id="capital-chart" viewBox="0 0 800 280" preserveAspectRatio="none" style="width:100%; height: 280px; display: block;"></svg>
  <p style="color: var(--muted); font-size: 12px; margin-top: 8px;">
    Cumulative net cashflow committed to Scalable (deposits − withdrawals). Distributions, interest and tax NOT included — those are return ON capital, not capital itself. Dashed line at the right end marks today's portfolio market value.
  </p>
</div>

</div>
