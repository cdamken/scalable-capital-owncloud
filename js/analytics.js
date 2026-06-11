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
    const svg = document.getElementById('ring-chart');
    const legend = document.getElementById('ring-legend');
    const items = [...holdings].sort((a, b) => b.value - a.value);
    if (cashBalance > 0) items.push({ name: 'Cash', isin: '—', value: cashBalance });
    const total = items.reduce((s, h) => s + h.value, 0);
    if (!total) {
      svg.innerHTML = '<text x="50" y="50" text-anchor="middle" fill="var(--muted)">No data</text>';
      legend.innerHTML = '';
      return;
    }

    let svgHtml = '', legendHtml = '', cumulative = 0;
    const cx = 50, cy = 50, r = 38, ringW = 12;
    items.forEach((h, i) => {
      const pct = h.value / total;
      const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
      cumulative += pct;
      const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
      const largeArc = pct > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
      const innerR = r - ringW;
      const x3 = cx + innerR * Math.cos(endAngle),   y3 = cy + innerR * Math.sin(endAngle);
      const x4 = cx + innerR * Math.cos(startAngle), y4 = cy + innerR * Math.sin(startAngle);
      const color = COLORS[i % COLORS.length];
      svgHtml += '<path class="slice" d="M ' + x1 + ' ' + y1 +
        ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 +
        ' L ' + x3 + ' ' + y3 +
        ' A ' + innerR + ' ' + innerR + ' 0 ' + largeArc + ' 0 ' + x4 + ' ' + y4 +
        ' Z" fill="' + color + '"><title>' + escapeHtml(h.name) + ': ' +
        (pct * 100).toFixed(1) + '% — ' + fmtMoney(h.value) + '</title></path>';
      legendHtml += '<div class="legend-row">' +
        '<span class="dot" style="background: ' + color + ';"></span>' +
        '<span class="name">' + escapeHtml(h.name) + '</span>' +
        '<span class="pct">' + (pct * 100).toFixed(1) + '%</span>' +
        '<span class="val">' + fmtMoney(h.value) + '</span>' +
        '</div>';
    });
    svgHtml += '<text x="50" y="48" text-anchor="middle" fill="var(--muted)" style="font-size: 5px;">TOTAL</text>';
    svgHtml += '<text x="50" y="56" text-anchor="middle" fill="var(--text)" style="font-size: 6.5px; font-weight: 700;">' +
      fmtMoney(total) + '</text>';
    svg.innerHTML = svgHtml;
    legend.innerHTML = legendHtml;
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

  function renderBarChart(svgId, byKey) {
    const svg = document.getElementById(svgId);
    svg.innerHTML = '';
    const keys = Object.keys(byKey).sort();
    if (!keys.length) {
      svg.innerHTML = '<text x="300" y="140" text-anchor="middle">No data</text>';
      return;
    }
    const values = keys.map(k => byKey[k]);
    const maxV = Math.max(...values, 1);
    const W = 600, H = 280;
    const M = { top: 20, right: 20, bottom: 40, left: 60 };
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;
    const barW = innerW / keys.length * 0.65;
    const gap  = innerW / keys.length * 0.35;

    svg.innerHTML += '<line class="axis-line" x1="' + M.left + '" y1="' + (M.top + innerH) +
      '" x2="' + (M.left + innerW) + '" y2="' + (M.top + innerH) + '"/>';
    for (let i = 0; i <= 4; i++) {
      const y = M.top + innerH - (innerH * i / 4);
      const val = maxV * i / 4;
      svg.innerHTML += '<line class="axis-line" x1="' + M.left + '" y1="' + y +
        '" x2="' + (M.left + innerW) + '" y2="' + y + '" stroke-dasharray="2,3" opacity="0.3"/>';
      svg.innerHTML += '<text x="' + (M.left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
        fmtMoney(val) + '</text>';
    }
    keys.forEach((k, i) => {
      const v = byKey[k];
      const h = v / maxV * innerH;
      const x = M.left + (innerW / keys.length) * i + gap / 2;
      const y = M.top + innerH - h;
      svg.innerHTML += '<rect class="bar" x="' + x + '" y="' + y + '" width="' + barW +
        '" height="' + h + '" rx="4" fill="var(--blue)"><title>' + escapeHtml(k) + ': ' +
        fmtMoney(v) + '</title></rect>';
      svg.innerHTML += '<text class="bar-label" x="' + (x + barW / 2) + '" y="' + (y - 6) +
        '" text-anchor="middle">' + fmtMoney(v) + '</text>';
      svg.innerHTML += '<text x="' + (x + barW / 2) + '" y="' + (M.top + innerH + 18) +
        '" text-anchor="middle">' + escapeHtml(k) + '</text>';
    });
  }

  function renderCapitalLine(all, currentValue) {
    const svg = document.getElementById('capital-chart');
    svg.innerHTML = '';

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
      svg.innerHTML = '<text x="400" y="140" text-anchor="middle">No deposits/withdrawals yet</text>';
      return;
    }
    events.sort((a, b) => a.date - b.date);
    let running = 0;
    const series = events.map(e => { running += e.delta; return { date: e.date, value: running }; });

    const W = 800, H = 280;
    const M = { top: 20, right: 40, bottom: 40, left: 70 };
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;

    const t0 = series[0].date.getTime();
    const t1 = Math.max(series[series.length - 1].date.getTime(), Date.now());
    const minY = Math.min(0, ...series.map(s => s.value));
    const maxY = Math.max(series[series.length - 1].value, currentValue, 1);
    const yRange = maxY - minY || 1;
    const xRange = t1 - t0 || 1;
    const X = (d) => M.left + ((d.getTime() - t0) / xRange) * innerW;
    const Y = (v) => M.top + innerH - ((v - minY) / yRange) * innerH;

    svg.innerHTML += '<line class="axis-line" x1="' + M.left + '" y1="' + (M.top + innerH) +
      '" x2="' + (M.left + innerW) + '" y2="' + (M.top + innerH) + '"/>';
    for (let i = 0; i <= 4; i++) {
      const y = M.top + innerH - (innerH * i / 4);
      const val = minY + yRange * i / 4;
      svg.innerHTML += '<line class="axis-line" x1="' + M.left + '" y1="' + y +
        '" x2="' + (M.left + innerW) + '" y2="' + y + '" stroke-dasharray="2,3" opacity="0.3"/>';
      svg.innerHTML += '<text x="' + (M.left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
        fmtMoney(val) + '</text>';
    }
    const labels = [t0, t0 + xRange / 2, t1];
    labels.forEach(ts => {
      const x = M.left + ((ts - t0) / xRange) * innerW;
      svg.innerHTML += '<text x="' + x + '" y="' + (M.top + innerH + 18) +
        '" text-anchor="middle">' + fmtDate(new Date(ts).toISOString()) + '</text>';
    });

    let path = '';
    series.forEach((s, i) => {
      const x = X(s.date), y = Y(s.value);
      if (i === 0) { path += 'M ' + x + ' ' + y + ' '; }
      else {
        const prev = series[i - 1];
        path += 'L ' + X(s.date) + ' ' + Y(prev.value) + ' L ' + x + ' ' + y + ' ';
      }
    });
    const last = series[series.length - 1];
    path += 'L ' + X(new Date()) + ' ' + Y(last.value) + ' ';
    svg.innerHTML += '<path d="' + path + '" fill="none" stroke="var(--blue)" stroke-width="2"/>';

    const yCurrent = Y(currentValue);
    svg.innerHTML += '<line x1="' + M.left + '" y1="' + yCurrent + '" x2="' + (M.left + innerW) +
      '" y2="' + yCurrent + '" stroke="var(--green)" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>';
    svg.innerHTML += '<circle cx="' + X(new Date()) + '" cy="' + yCurrent + '" r="4" fill="var(--green)"/>';
    svg.innerHTML += '<text x="' + (M.left + innerW + 4) + '" y="' + (yCurrent + 4) +
      '" text-anchor="start" fill="var(--green)" style="font-weight:600;">' + fmtMoney(currentValue) + '</text>';
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
