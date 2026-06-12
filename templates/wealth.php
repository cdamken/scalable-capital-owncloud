<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Scalable-Capital-Dashboard/app/wealth.html body.
 * Wealth-detail page is Scalable-only (no TR sibling). Same 9 mechanical
 * patches applied.
 */
?>
<div id="sc-app" class="wealth-page"
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

<div class="top-bar">
  <div class="brand"><span class="logo-box"></span> Scalable Capital</div>
  <nav>
    <a class="tab" href="<?php p($routes['index']); ?>">Portfolio</a>
    <a class="tab" href="<?php p($routes['analytics']); ?>">Analytics</a>
    <a class="tab" href="<?php p($routes['orders']); ?>">📋 Orders</a>
    <a class="tab" href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
    <a class="tab" href="<?php p($routes['ledger']); ?>">📒 Ledger</a>
    <a class="tab active" href="<?php p($routes['wealth']); ?>">🏦 Wealth</a>
    <a class="tab" href="<?php p($routes['glossary']); ?>">📖 Glossary</a>
    <a class="tab" href="<?php p($routes['settings']); ?>">⚙ Settings</a>
  </nav>
  <div class="actions">
    <span id="staleness" class="staleness">never updated</span>
    <button id="update-btn" class="btn btn-primary">⟳ Update Now</button>
  </div>
</div>

<div class="picker">
  <label style="color: var(--muted); font-size: 12px; margin-right: 8px;">Wealth portfolio:</label>
  <select id="portfolio-picker"><option value="">Loading…</option></select>
</div>

<div id="empty-msg" style="display:none; padding: 40px; text-align: center; color: var(--muted);
     background: var(--card); border: 1px solid var(--border); border-radius: 12px;">
  No wealth detail yet. Click <em>Update Now</em> to fetch it.
</div>

<div id="toast"><span id="toast-msg">…</span></div>

<div id="detail-view" style="display: none;">
  <div class="info-row" id="info-row"></div>

  <div class="grid">
    <div class="card">
      <div class="label">Current value</div>
      <div class="value" id="kpi-value">—</div>
      <div class="sub" id="kpi-value-sub">latest realTimeValuation</div>
    </div>
    <div class="card">
      <div class="label">TWR since start</div>
      <div class="value" id="kpi-twr">—</div>
      <div class="sub" id="kpi-twr-sub">time-weighted return</div>
    </div>
    <div class="card">
      <div class="label">Net contributions</div>
      <div class="value" id="kpi-contrib" style="color: var(--text);">—</div>
      <div class="sub" id="kpi-contrib-sub">deposits + transfers (gross of fees)</div>
    </div>
    <div class="card">
      <div class="label">Fees paid</div>
      <div class="value neg" id="kpi-fees">—</div>
      <div class="sub" id="kpi-fees-sub">— fee charges</div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <h2>Allocation (latest)</h2>
      <div class="chart-wrap">
        <div class="alloc">
          <svg id="alloc-ring" viewBox="0 0 100 100"></svg>
          <div class="legend" id="alloc-legend"></div>
        </div>
        <p style="color: var(--muted); font-size: 12px; margin-top: 14px;" id="alloc-date">—</p>
      </div>
    </div>
    <div>
      <h2>Time-weighted return</h2>
      <div class="chart-wrap">
        <div class="range-pills" id="range-pills">
          <button data-range="1W">1W</button>
          <button data-range="1M">1M</button>
          <button data-range="3M">3M</button>
          <button data-range="6M">6M</button>
          <button data-range="1Y">1Y</button>
          <button data-range="ALL" class="active">All</button>
          <span class="range-label" id="range-info">—</span>
        </div>
        <svg id="twr-chart" viewBox="0 0 600 280" preserveAspectRatio="none" style="width:100%; height: 280px; display:block;"></svg>
      </div>
    </div>
  </div>

  <h2>Portfolio value vs capital invested</h2>
  <div class="chart-wrap">
    <div style="display: flex; gap: 16px; margin-bottom: 10px; font-size: 12px; align-items: center;">
      <span style="display: inline-flex; align-items: center; gap: 6px;">
        <span style="width: 14px; height: 3px; background: var(--blue); display: inline-block;"></span>
        <span style="color: var(--text);">Portfolio value</span>
      </span>
      <span style="display: inline-flex; align-items: center; gap: 6px;">
        <span style="width: 14px; height: 0; border-top: 2px dashed var(--muted); display: inline-block;"></span>
        <span style="color: var(--text);">Capital invested (deposits − withdrawals, cumulative)</span>
      </span>
      <span class="range-label" id="value-gap" style="margin-left: auto;">—</span>
    </div>
    <svg id="value-chart" viewBox="0 0 800 320" preserveAspectRatio="none" style="width:100%; height: 320px; display:block;"></svg>
    <p style="color: var(--muted); font-size: 12px; margin-top: 10px;">
      The gap between the two lines is your <strong>real return</strong> — what the
      portfolio earned beyond what you put in. Steps in the dashed line are
      deposits/withdrawals; the solid line moves with the market.
    </p>
  </div>

  <h2>Underlying ETFs</h2>
  <table class="etf-table" id="etf-table">
    <thead><tr>
      <th>ISIN</th>
      <th>Asset class</th>
      <th>Weight</th>
      <th>Valuation</th>
    </tr></thead>
    <tbody></tbody>
  </table>

  <h2>Recent transactions</h2>
  <table class="etf-table" id="tx-table">
    <thead><tr>
      <th>Date</th>
      <th>Type</th>
      <th>Description</th>
      <th>State</th>
      <th>Amount</th>
    </tr></thead>
    <tbody></tbody>
  </table>
</div>

</div>
