/* global fmtMoney, fmtPct, fmtDate, on, escapeHtml, getJSON, readRoutes, dataUrl, refreshStaleness */
/**
 * Analytics page — verbatim port of Scalable-Capital-Dashboard/app/analytics.html
 * inline <script>. Patches per OWNCLOUD-PATCHES.md.
 *
 * Charts are pure SVG (no Chart.js). XIRR Newton-Raphson, ring chart, bar
 * charts and the capital-line are all hand-rolled in the upstream source —
 * ported verbatim.
 */
(function () {
  'use strict';

  const COLORS = ['#00b8a9', '#3b82f6', '#c084fc', '#fb923c', '#4ade80',
                  '#fbbf24', '#f472b6', '#facc15', '#60a5fa', '#94a3b8',
                  '#a78bfa', '#34d399'];

  // ISIN 2-letter prefix → country name. Verbatim from upstream.
  const ISIN_COUNTRIES = {
    US: 'United States', DE: 'Germany', FR: 'France', GB: 'United Kingdom',
    IE: 'Ireland (UCITS)', LU: 'Luxembourg', NL: 'Netherlands',
    ES: 'Spain', IT: 'Italy', CH: 'Switzerland', AT: 'Austria',
    SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
    BE: 'Belgium', PT: 'Portugal', GR: 'Greece', PL: 'Poland',
    JP: 'Japan', CA: 'Canada', AU: 'Australia',
    HK: 'Hong Kong', KR: 'South Korea', CN: 'China', TW: 'Taiwan',
    IN: 'India', BR: 'Brazil', MX: 'Mexico', IL: 'Israel',
    KY: 'Cayman Islands', BM: 'Bermuda', VG: 'British Virgin Islands',
    JE: 'Jersey', GG: 'Guernsey', IM: 'Isle of Man',
  };

  let routes;

  // XIRR Newton-Raphson — verbatim from upstream.
  function xirr(cashflows, guess = 0.1) {
    if (!cashflows || cashflows.length < 2) return null;
    const t0 = cashflows[0].date.getTime();
    const years = cashflows.map(cf => (cf.date.getTime() - t0) / (365.25 * 86400000));

    function npv(rate) {
      let s = 0;
      for (let i = 0; i < cashflows.length; i++) {
        s += cashflows[i].amount / Math.pow(1 + rate, years[i]);
      }
      return s;
    }
    function dnpv(rate) {
      let s = 0;
      for (let i = 0; i < cashflows.length; i++) {
        s -= years[i] * cashflows[i].amount / Math.pow(1 + rate, years[i] + 1);
      }
      return s;
    }

    let rate = guess;
    for (let i = 0; i < 100; i++) {
      const f = npv(rate);
      const fp = dnpv(rate);
      if (Math.abs(fp) < 1e-12) break;
      const newRate = rate - f / fp;
      if (!isFinite(newRate)) break;
      if (Math.abs(newRate - rate) < 1e-8) return newRate;
      rate = newRate;
      if (rate <= -1) rate = -0.99;
    }
    if (isFinite(rate) && Math.abs(npv(rate)) < 0.01) return rate;
    return null;
  }

  async function load() {
    await refreshStaleness(routes);
    const [tx, inv, cash, broker] = await Promise.all([
      getJSON(dataUrl(routes, 'transactions')),
      getJSON(dataUrl(routes, 'inventory')),
      getJSON(dataUrl(routes, 'cash')),
      getJSON(dataUrl(routes, 'broker_overview')),
    ]);

    const all = (tx && tx.transactions) || [];

    const groupedSecurities = (((inv || {}).portfolioGroups || {}).items || [])
      .flatMap(g => g.items || []);
    const ungrouped = (((inv || {}).ungroupedInventoryItems) || {}).items || [];
    const allItems = [...groupedSecurities, ...ungrouped];
    const holdings = allItems.map(sec => {
      const pos = (sec.inventory && sec.inventory.position) || {};
      const qty = (pos.filled || 0) + (pos.pending || 0) + (pos.blocked || 0);
      const tick = sec.quoteTick || {};
      const value = tick.midPrice != null ? tick.midPrice * qty : 0;
      // FIFO cost basis (what you paid) — for yield-on-cost below.
      const cost = pos.fifoPrice != null ? pos.fifoPrice * qty : 0;
      return { name: sec.name || sec.isin || '—', isin: sec.isin, value, cost };
    }).filter(h => h.value > 0);

    const securitiesValue = holdings.reduce((s, h) => s + h.value, 0);
    const cashBalance = (((cash || {}).buyingPower) || {}).cashBalance || 0;
    const currentValue = securitiesValue + cashBalance;

    const cashflows = [];
    let netCapital = 0, totalDistributions = 0, distCount = 0;
    for (const t of all) {
      if (t.type !== 'CASH_TRANSACTION') continue;
      const date = new Date(t.lastEventDateTime);
      if (isNaN(date.getTime())) continue;
      const amt = Number(t.amount) || 0;
      const ct = t.cashTransactionType;
      if (ct === 'DEPOSIT') {
        cashflows.push({ date, amount: -amt });
        netCapital += amt;
      } else if (ct === 'WITHDRAWAL') {
        cashflows.push({ date, amount: Math.abs(amt) });
        netCapital -= Math.abs(amt);
      } else if (ct === 'DISTRIBUTION') {
        totalDistributions += amt;
        distCount += 1;
      }
    }

    let xirrPct = null;
    if (cashflows.length && currentValue > 0) {
      const today = new Date();
      const cfsForXirr = [...cashflows, { date: today, amount: currentValue }];
      cfsForXirr.sort((a, b) => a.date - b.date);
      xirrPct = xirr(cfsForXirr);
    }
    const lifetimePnl = currentValue - netCapital;

    const xirrEl = document.getElementById('kpi-xirr');
    xirrEl.textContent = fmtPct(xirrPct);
    xirrEl.className = 'value ' + (xirrPct == null ? '' : xirrPct >= 0 ? 'pos' : 'neg');

    const pnlEl = document.getElementById('kpi-lifetime');
    pnlEl.textContent = fmtMoney(lifetimePnl);
    pnlEl.className = 'value ' + (lifetimePnl >= 0 ? 'pos' : 'neg');
    document.getElementById('kpi-lifetime-sub').textContent =
      fmtMoney(currentValue) + ' − ' + fmtMoney(netCapital) + ' committed';

    document.getElementById('kpi-net-capital').textContent   = fmtMoney(netCapital);
    document.getElementById('kpi-distributions').textContent = fmtMoney(totalDistributions);
    document.getElementById('kpi-distrib-count').textContent =
      distCount + ' payment' + (distCount === 1 ? '' : 's');

    // Yield on cost — forward 12m dividend ÷ FIFO cost basis. Verbatim
    // port from the SC dashboard analytics.html. Parity with TR.
    const yocEl = document.getElementById('kpi-yoc');
    const yocSub = document.getElementById('kpi-yoc-sub');
    if (yocEl) {
      const costBasis = holdings.reduce((s, h) => s + (h.cost || 0), 0);
      const distDates = all
        .filter(t => t.cashTransactionType === 'DISTRIBUTION')
        .map(t => new Date(t.lastEventDateTime))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a - b);
      if (costBasis > 0 && distDates.length) {
        const spanDays = Math.max(
          1, Math.round((distDates[distDates.length - 1] - distDates[0]) / 86400000));
        if (spanDays >= 90) {
          const fwd = spanDays < 365 ? totalDistributions * (365 / spanDays) : totalDistributions;
          yocEl.textContent = (fwd / costBasis * 100).toFixed(2) + '%';
          if (yocSub) yocSub.textContent = fmtMoney(fwd) + ' fwd ÷ ' + fmtMoney(costBasis) + ' cost';
        } else {
          yocEl.textContent = '—';
          if (yocSub) yocSub.textContent = 'only ' + spanDays + 'd of dividend history (need ≥90d)';
        }
      } else {
        yocEl.textContent = '—';
        if (yocSub) yocSub.textContent = costBasis > 0 ? 'no distributions yet' : 'no cost basis';
      }
    }

    const tbody = document.getElementById('twr-tbody');
    tbody.innerHTML = '';
    let twrData = [];
    const perfGroups = (((inv || {}).portfolioGroups || {}).items || []);
    if (perfGroups.length && perfGroups[0].performance) {
      twrData = perfGroups[0].performance.performancesByTimeframe || [];
    }
    // `broker` would also be a fallback source — referenced for parity with
    // upstream (which keeps the var for future expansion).
    void broker;
    if (!twrData.length) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--muted);">TWR not in current data (refresh to pull).</td></tr>';
    } else {
      const order = ['INTRADAY', 'TWO_DAYS', 'ONE_WEEK', 'ONE_MONTH',
                     'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR',
                     'YEAR_TO_DATE', 'MAX'];
      twrData.sort((a, b) => order.indexOf(a.timeframe) - order.indexOf(b.timeframe));
      for (const t of twrData) {
        const tr = document.createElement('tr');
        const cls = (t.performance ?? 0) >= 0 ? 'pos' : 'neg';
        const absCls = (t.simpleAbsoluteReturn ?? 0) >= 0 ? 'pos' : 'neg';
        tr.innerHTML =
          '<td>' + escapeHtml(t.timeframe) + '</td>' +
          '<td class="' + cls + '">' + fmtPct(t.performance) + '</td>' +
          '<td class="' + absCls + '">' + fmtMoney(t.simpleAbsoluteReturn) + '</td>';
        tbody.appendChild(tr);
      }
    }

    renderRingChart(holdings, cashBalance);

    const byYear = {};
    for (const t of all) {
      if (t.cashTransactionType !== 'DISTRIBUTION') continue;
      const year = (t.lastEventDateTime || '').slice(0, 4) || '—';
      byYear[year] = (byYear[year] || 0) + (Number(t.amount) || 0);
    }
    renderBarChart('dividends-chart', byYear);

    renderGeoChart(holdings);
    renderCapitalLine(all, currentValue);
  }

  function renderRingChart(holdings, cashBalance) {
    const legend = document.getElementById('ring-legend');
    const items = [...holdings].sort((a, b) => b.value - a.value);
    if (cashBalance > 0) items.push({ name: 'Cash', isin: '—', value: cashBalance });
    const total = items.reduce((s, h) => s + h.value, 0);
    if (!total) {
      if (legend) legend.innerHTML = '';
      scDonut('ring-chart', [], [], []);
      return;
    }
    const colors = items.map((h, i) => COLORS[i % COLORS.length]);
    let legendHtml = '';
    items.forEach((h, i) => {
      const pct = h.value / total;
      legendHtml += '<div class="legend-row">' +
        '<span class="dot" style="background: ' + colors[i] + ';"></span>' +
        '<span class="name">' + escapeHtml(h.name) + '</span>' +
        '<span class="pct">' + (pct * 100).toFixed(1) + '%</span>' +
        '<span class="val">' + fmtMoney(h.value) + '</span>' +
        '</div>';
    });
    if (legend) legend.innerHTML = legendHtml;
    // Drawing handled by Chart.js (js/charts.js); legend stays custom HTML.
    scDonut('ring-chart', items.map(h => h.name), items.map(h => h.value), colors);
  }

  function renderGeoChart(holdings) {
    const byCountry = {};
    for (const h of holdings) {
      const prefix = (h.isin || '').slice(0, 2).toUpperCase();
      if (!/^[A-Z]{2}$/.test(prefix)) continue;
      const label = ISIN_COUNTRIES[prefix] || ('Other (' + prefix + ')');
      byCountry[label] = (byCountry[label] || 0) + (Number(h.value) || 0);
    }
    const total = Object.values(byCountry).reduce((s, v) => s + v, 0);
    const sub = document.getElementById('geo-substat');
    if (sub) {
      const n = Object.keys(byCountry).length;
      sub.textContent = n + ' ' + (n === 1 ? 'country' : 'countries') +
        ' · ' + fmtMoney(total) +
        ' total — by ISIN domicile, not revenue exposure.';
    }
    renderBarChart('geo-chart', byCountry);
  }


  function renderCapitalLine(all, currentValue) {
    const events = [];
    for (const t of all) {
      if (t.type !== 'CASH_TRANSACTION') continue;
      const date = new Date(t.lastEventDateTime);
      if (isNaN(date.getTime())) continue;
      const ct = t.cashTransactionType;
      const amt = Number(t.amount) || 0;
      if (ct === 'DEPOSIT') events.push({ date, delta: amt });
      else if (ct === 'WITHDRAWAL') events.push({ date, delta: -Math.abs(amt) });
    }
    if (!events.length) {
      scStepLine('capital-chart', [], null);
      return;
    }
    events.sort((a, b) => a.date - b.date);
    let running = 0;
    const series = events.map(e => { running += e.delta; return { date: e.date, value: running }; });
    // Drawing handled by Chart.js (js/charts.js): stepped net-capital line +
    // dashed reference at today's market value.
    scStepLine('capital-chart', series, currentValue);
  }

  function init() {
    if (!document.getElementById('sc-app')) return;
    routes = readRoutes();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
