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
    // Total distributions + Yield on cost are shown on the Dividends page now.

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

    // Dividends-per-year chart lives on the Dividends page now (it duplicated
    // the "By year" chart there). Analytics stays focused on performance,
    // allocation and the benchmark replay.

    renderGeoChart(holdings);

    // Benchmark replay (MSCI World / S&P 500 / Nasdaq 100 — EUR UCITS ETFs,
    // same three indices as the TR dashboard). Fetched via the /benchmark
    // proxy (24h cache); a failed symbol just drops its overlay (getJSON → null).
    const BENCHMARKS = [
      { label: 'MSCI World', color: '#fbbf24', sym: 'IWDA.AS' },
      { label: 'S&P 500',    color: '#34d399', sym: 'VUSA.AS' },
      { label: 'Nasdaq 100', color: '#c084fc', sym: 'CNDX.AS' },
    ];
    // Defensive: if the benchmark route is missing, still render the capital
    // line (no overlay) instead of throwing and blanking the whole chart.
    const benchmarkUrl = (sym) =>
      routes.benchmark ? routes.benchmark.replace('__SYMBOL__', encodeURIComponent(sym)) : null;
    const benchmarks = await Promise.all(BENCHMARKS.map(async b => {
      const url = benchmarkUrl(b.sym);
      return { label: b.label, color: b.color, bench: url ? await getJSON(url) : null };
    }));
    renderCapitalLine(all, currentValue, benchmarks);
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


  // ── Net capital committed vs benchmarks ─────────────────────────────────
  // Verbatim port of Scalable-Capital-Dashboard/app/analytics.html: a daily
  // committed-capital line (cumulative deposits − withdrawals) with index-
  // replay overlays + range pills. Same _replayBenchmark algorithm as
  // gbm-dashboard so all three trios match.
  let _capChart = null;
  let _capRange = 'ALL';
  let _capDailyMap = null;
  let _capBenchmarks = [];

  function _replayBenchmark(bench, dailyMap) {
    if (!bench || !bench.history || bench.history.length === 0) return null;
    if (!dailyMap || dailyMap.size === 0) return null;
    const benchByDay = {};
    for (const h of bench.history) benchByDay[h.date] = h.close;
    const sortedBenchDates = Object.keys(benchByDay).sort();
    if (sortedBenchDates.length === 0) return null;
    const userDates = [...dailyMap.keys()].sort();
    const startDate = new Date(userDates[0] + 'T00:00:00Z');
    const lastBenchDate = sortedBenchDates[sortedBenchDates.length - 1];
    const endDate = new Date(lastBenchDate + 'T00:00:00Z');
    const today = new Date();
    if (today > endDate) endDate.setTime(today.getTime());
    let units = 0, prevCostBasis = null, lastClose = null;
    const out = {};
    for (let cur = new Date(startDate); cur <= endDate; cur.setUTCDate(cur.getUTCDate() + 1)) {
      const dateStr = cur.toISOString().slice(0, 10);
      if (benchByDay[dateStr] != null) lastClose = benchByDay[dateStr];
      if (dailyMap.has(dateStr)) {
        const cb = dailyMap.get(dateStr);
        const delta = prevCostBasis == null ? cb : (cb - prevCostBasis);
        if (delta !== 0 && lastClose != null && lastClose > 0) units += delta / lastClose;
        prevCostBasis = cb;
      }
      if (lastClose != null && lastClose > 0 && units !== 0) out[dateStr] = +(units * lastClose).toFixed(2);
    }
    return out;
  }

  function renderCapitalLine(all, currentValue, benchmarks) {
    const events = [];
    for (const t of all) {
      if (t.type !== 'CASH_TRANSACTION') continue;
      const d = new Date(t.lastEventDateTime);
      if (isNaN(d.getTime())) continue;
      const ct = t.cashTransactionType;
      const amt = Number(t.amount) || 0;
      if (ct === 'DEPOSIT') events.push({ date: d, delta: amt });
      else if (ct === 'WITHDRAWAL') events.push({ date: d, delta: -Math.abs(amt) });
    }
    events.sort((a, b) => a.date - b.date);
    const dailyMap = new Map();
    let running = 0;
    for (const e of events) {
      running += e.delta;
      dailyMap.set(e.date.toISOString().slice(0, 10), Math.round(running * 100) / 100);
    }
    if (dailyMap.size) {
      const today = new Date().toISOString().slice(0, 10);
      const dates = [...dailyMap.keys()].sort();
      const lastDate = dates[dates.length - 1];
      if (lastDate !== today) dailyMap.set(today, dailyMap.get(lastDate));
    }
    _capDailyMap = dailyMap;
    _capBenchmarks = (benchmarks || []).filter(Boolean);
    drawCapitalChart();
  }

  function drawCapitalChart() {
    const canvas = document.getElementById('capital-chart');
    if (!canvas || typeof window.Chart !== 'function') return;
    const dailyMap = _capDailyMap;
    if (!dailyMap || dailyMap.size === 0) {
      if (_capChart) { _capChart.destroy(); _capChart = null; }
      return;
    }
    const datesSorted = [...dailyMap.keys()].sort();
    const rangeDays = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }[_capRange];
    let filteredDates = datesSorted;
    if (rangeDays) {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - rangeDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      filteredDates = datesSorted.filter(d => d >= cutoffStr);
      if (filteredDates.length === 0) filteredDates = [datesSorted[datesSorted.length - 1]];
    }
    const labels = filteredDates;
    const values = filteredDates.map(d => dailyMap.get(d));

    const info = document.getElementById('capital-range-info');
    if (info) info.textContent = filteredDates[0] + ' → ' + filteredDates[filteredDates.length - 1];

    // Rebase a benchmark so it STARTS at the same height as the user's line
    // at the left edge of the window (subtract the pre-window head-start),
    // otherwise an index that already ran up looks like it "starts higher".
    // No-op in the "All" view.
    const rebaseToStart = (series) => {
      let i = 0;
      while (i < series.length && (series[i] == null || values[i] == null)) i++;
      if (i >= series.length) return series;
      const offset = series[i] - values[i];
      return series.map(v => v == null ? null : +(v - offset).toFixed(2));
    };
    const benchDatasets = [];
    for (const b of _capBenchmarks) {
      const m = _replayBenchmark(b.bench, dailyMap);
      if (!m) continue;
      const aligned = rebaseToStart(filteredDates.map(d => (m[d] != null ? m[d] : null)));
      if (!aligned.some(v => v != null)) continue;
      benchDatasets.push({
        label: "If you'd bought " + b.label + ' instead',
        data: aligned,
        borderColor: b.color, backgroundColor: 'transparent',
        borderWidth: 2, borderDash: [6, 4], fill: false, tension: 0.15,
        pointRadius: 0, pointHoverRadius: 5, spanGaps: true,
      });
    }

    const datasets = [{
      label: 'Net capital committed',
      data: values,
      borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.10)',
      borderWidth: 2, fill: true, tension: 0.15,
      pointRadius: 0, pointHoverRadius: 5,
    }].concat(benchDatasets);

    if (_capChart) _capChart.destroy();
    _capChart = new window.Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        maintainAspectRatio: false,
        animation: { duration: 500, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: datasets.length > 1,
            labels: { color: '#e8eef5', font: { size: 12 }, usePointStyle: true, pointStyle: 'line', padding: 12 } },
          tooltip: { callbacks: { label: (ctx) => ' ' + (ctx.dataset.label || '') + ': ' + fmtMoney(ctx.parsed.y) } },
        },
        scales: {
          x: { ticks: { color: '#7a8599', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8,
                 callback: function (v) { const l = this.getLabelForValue(v); const d = new Date(l);
                   return isNaN(d) ? l : d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); } },
               grid: { display: false } },
          y: { ticks: { color: '#7a8599', font: { size: 11 }, callback: (v) => fmtMoney(v) },
               grid: { color: 'rgba(42,49,66,0.5)' } },
        },
      },
    });
  }

  function init() {
    if (!document.getElementById('sc-app')) return;
    routes = readRoutes();
    document.querySelectorAll('#capital-range-pills button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#capital-range-pills button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _capRange = btn.dataset.range;
        drawCapitalChart();
      });
    });
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
