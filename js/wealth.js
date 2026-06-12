/* global fmtMoney, fmtPct, fmtDate, on, escapeHtml, getJSON, readRoutes, dataUrl, refreshStaleness, showToast */
/**
 * Wealth detail page — verbatim port of Scalable-Capital-Dashboard/app/wealth.html
 * inline <script>. Patches per OWNCLOUD-PATCHES.md.
 *
 * No TR sibling for this page — Scalable-only. Pure SVG charts (no Chart.js).
 */
(function () {
  'use strict';

  let routes;
  let allWealth = [];
  let current = null;
  let twrRange = 'ALL';

  // TWR is reported as CUMULATIVE time-weighted return since inception. To get
  // the return over a SELECTED window you cannot just read the last point —
  // that is always the since-inception figure, which is why every range used
  // to show the same %. Rebase instead: TWR chains geometrically, so the
  // window return is (1 + cumAtWindowEnd) / (1 + cumAtWindowStart) − 1.
  const TWR_RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 91, '6M': 183, '1Y': 365 };

  function sliceTwrByRange(history, range) {
    const series = history || [];
    if (range === 'ALL' || !series.length) return series;
    const days = TWR_RANGE_DAYS[range];
    if (!days) return series;
    const cutoff = new Date(series[series.length - 1].date);
    cutoff.setDate(cutoff.getDate() - days);
    return series.filter(s => new Date(s.date) >= cutoff);
  }

  // Return over the selected window, rebased so e.g. '1M' is the last month's
  // gain (not the cumulative-since-start figure). null when not computable.
  function windowedTwr(history, range) {
    const series = sliceTwrByRange(history, range);
    if (series.length < 2) {
      return series.length ? series[series.length - 1].timeWeightedReturn : null;
    }
    const startCum = series[0].timeWeightedReturn;
    const endCum   = series[series.length - 1].timeWeightedReturn;
    if (startCum == null || endCum == null) return null;
    return (1 + endCum) / (1 + startCum) - 1;
  }

  const CLASS_COLORS = {
    EQUITIES:    { color: 'var(--equities)',    badge: 'equities' },
    BONDS:       { color: 'var(--bonds)',       badge: 'bonds' },
    COMMODITIES: { color: 'var(--commodities)', badge: 'commodities' },
    CASH:        { color: 'var(--cash)',        badge: 'cash' },
  };
  function classStyle(type) {
    return CLASS_COLORS[type] || { color: 'var(--other)', badge: 'other' };
  }

  async function load() {
    await refreshStaleness(routes);
    const data = await getJSON(dataUrl(routes, 'wealth_detail'));
    if (!data || !Array.isArray(data) || !data.length) {
      const em = document.getElementById('empty-msg');
      const dv = document.getElementById('detail-view');
      if (em) em.style.display = 'block';
      if (dv) dv.style.display = 'none';
      const picker = document.getElementById('portfolio-picker');
      if (picker) picker.innerHTML = '<option value="">No wealth portfolios</option>';
      return;
    }
    allWealth = data;
    document.getElementById('empty-msg').style.display = 'none';
    document.getElementById('detail-view').style.display = 'block';

    const picker = document.getElementById('portfolio-picker');
    picker.innerHTML = '';
    for (const w of allWealth) {
      const opt = document.createElement('option');
      opt.value = w.id;
      const name = (w.personalizations && w.personalizations.name) || w.id;
      const cancelled = ((w.portfolioSummary || {}).cancelled) ? ' (cancelled)' : '';
      opt.textContent = name + cancelled + ' — ' + fmtMoney(((w.realTimeValuation || {}).valuation));
      picker.appendChild(opt);
    }
    const preferred = [...allWealth].sort((a, b) => {
      const ac = ((a.portfolioSummary || {}).cancelled) ? 1 : 0;
      const bc = ((b.portfolioSummary || {}).cancelled) ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return (((b.realTimeValuation || {}).valuation) || 0) - (((a.realTimeValuation || {}).valuation) || 0);
    })[0];
    picker.value = preferred.id;
    selectPortfolio(preferred.id);
  }

  function selectPortfolio(id) {
    current = allWealth.find(w => w.id === id) || null;
    if (!current) return;
    renderInfo();
    renderKPIs();
    renderAllocation();
    renderTwrChart();
    renderValueChart();
    renderEtfTable();
    renderTxTable();
  }

  function renderInfo() {
    const w = current;
    const s = w.portfolioSummary || {};
    const r = s.riskView || {};
    const rows = [
      ['Type', s.portfolioType || '—'],
      ['Risk profile', r.riskCategory || '—'],
      ['Risk level', r.riskLevel ?? '—'],
      ['Custodian', (w.custodian || '—') + ' / ' + (w.custodianBank || '—')],
      ['Config', w.configuration || '—'],
      ['IBAN', (w.cashAccount && w.cashAccount.iban) || '—'],
      ['Recurring deposit', fmtMoney(s.recurringSum)],
      ['Recurring withdrawal', fmtMoney(s.recurringWithdrawalSum)],
      ['Status', s.cancelled ? 'CANCELLED' : (s.invested ? 'ACTIVE' : 'FUNDED')],
    ];
    document.getElementById('info-row').innerHTML = rows.map(([k, v]) =>
      '<div class="kv"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(String(v)) + '</div></div>'
    ).join('');
  }

  function renderKPIs() {
    const w = current;
    const val = (w.realTimeValuation || {}).valuation;
    document.getElementById('kpi-value').textContent = fmtMoney(val);
    document.getElementById('kpi-value-sub').textContent =
      'as of ' + fmtDate((w.realTimeValuation || {}).dateTime);

    // General TWR = cumulative time-weighted return SINCE INCEPTION. This is
    // the headline figure and does NOT change with the range pills — that is
    // the chart's job (the chart + its "Window return" show the per-period
    // number). Always the latest cumulative point.
    const twrLast = (w.timeWeightedReturnHistory || []).slice(-1)[0];
    const twrLastVal = twrLast ? twrLast.timeWeightedReturn : null;
    const twrEl = document.getElementById('kpi-twr');
    twrEl.textContent = fmtPct(twrLastVal);
    twrEl.className = 'value ' + (twrLastVal == null ? '' : twrLastVal >= 0 ? 'pos' : 'neg');

    let contributions = 0, fees = 0, feeCount = 0;
    for (const t of (w.transactions || [])) {
      const amt = Number(t.amount) || 0;
      if (t.type === 'FEE') { fees += Math.abs(amt); feeCount += 1; }
      else if (t.type === 'DEPOSIT' || t.type === 'TRANSFER_IN' || (t.type === 'PAYMENT' && amt > 0)) {
        contributions += Math.abs(amt);
      } else if (t.type === 'WITHDRAWAL' || t.type === 'TRANSFER_OUT' || (t.type === 'PAYMENT' && amt < 0)) {
        contributions -= Math.abs(amt);
      }
    }
    document.getElementById('kpi-contrib').textContent = fmtMoney(contributions);
    document.getElementById('kpi-fees').textContent = '−' + fmtMoney(fees).replace('−', '');
    document.getElementById('kpi-fees-sub').textContent =
      feeCount + ' fee charge' + (feeCount === 1 ? '' : 's');
  }

  function renderAllocation() {
    const svg = document.getElementById('alloc-ring');
    const legend = document.getElementById('alloc-legend');
    const dateEl = document.getElementById('alloc-date');
    svg.innerHTML = ''; legend.innerHTML = ''; dateEl.textContent = '';

    const alloc = current.latestAllocation;
    const classes = (alloc && alloc.assetClassAllocations) || [];
    if (!classes.length) {
      svg.innerHTML = '<text x="50" y="50" text-anchor="middle" fill="var(--muted)">No allocation</text>';
      dateEl.textContent = 'No allocation data (portfolio may be cancelled or unfunded).';
      return;
    }
    dateEl.textContent = 'as of ' + fmtDate(alloc.date);
    const total = classes.reduce((s, c) => s + (c.valuation || 0), 0) || 1;

    let svgHtml = '', legendHtml = '', cumulative = 0;
    const cx = 50, cy = 50, r = 38, ringW = 14;
    for (const c of classes) {
      const pct = (c.valuation || 0) / total;
      const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
      cumulative += pct;
      const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
      const largeArc = pct > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
      const innerR = r - ringW;
      const x3 = cx + innerR * Math.cos(endAngle),   y3 = cy + innerR * Math.sin(endAngle);
      const x4 = cx + innerR * Math.cos(startAngle), y4 = cy + innerR * Math.sin(startAngle);
      const sty = classStyle(c.type);
      svgHtml += '<path d="M ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' +
        x2 + ' ' + y2 + ' L ' + x3 + ' ' + y3 + ' A ' + innerR + ' ' + innerR + ' 0 ' +
        largeArc + ' 0 ' + x4 + ' ' + y4 + ' Z" fill="' + sty.color +
        '" stroke="var(--card)" stroke-width="0.5"><title>' + escapeHtml(c.type) + ': ' +
        fmtPct(pct, {decimals:1}) + ' — ' + fmtMoney(c.valuation) + '</title></path>';
      legendHtml += '<div class="row">' +
        '<span class="dot" style="background: ' + sty.color + ';"></span>' +
        '<span class="name"><span class="badge ' + sty.badge + '">' + escapeHtml(c.type) + '</span></span>' +
        '<span class="pct">' + (pct * 100).toFixed(1) + '%</span>' +
        '<span class="val">' + fmtMoney(c.valuation) + '</span>' +
        '</div>';
    }
    svgHtml += '<text x="50" y="48" text-anchor="middle" fill="var(--muted)" style="font-size: 5px;">TOTAL</text>';
    svgHtml += '<text x="50" y="55" text-anchor="middle" fill="var(--text)" style="font-size: 6px; font-weight:700;">' +
      fmtMoney(total) + '</text>';
    svg.innerHTML = svgHtml;
    legend.innerHTML = legendHtml;
  }

  function buildCapitalSeries(tx) {
    const events = [];
    for (const t of (tx || [])) {
      const date = t.bookingDate;
      if (!date) continue;
      const amt = Number(t.amount) || 0;
      let delta = 0;
      if (t.type === 'DEPOSIT' || t.type === 'TRANSFER_IN' ||
          (t.type === 'PAYMENT' && amt > 0)) {
        delta = Math.abs(amt);
      } else if (t.type === 'WITHDRAWAL' || t.type === 'TRANSFER_OUT' ||
                 (t.type === 'PAYMENT' && amt < 0)) {
        delta = -Math.abs(amt);
      } else {
        continue;
      }
      events.push({ date, delta });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    return events.map(e => { running += e.delta; return { date: e.date, value: running }; });
  }

  function alignCapitalToValuationDates(capitalSeries, valuationDates) {
    const result = [];
    let cursor = 0;
    let running = 0;
    for (const date of valuationDates) {
      while (cursor < capitalSeries.length && capitalSeries[cursor].date <= date) {
        running = capitalSeries[cursor].value;
        cursor += 1;
      }
      result.push({ date, value: running });
    }
    return result;
  }

  function renderTwrChart() {
    const raw = sliceTwrByRange(current.timeWeightedReturnHistory, twrRange);
    // Rebase the curve to the window start so the line begins at 0% and its
    // endpoint equals the Window return / KPI. Plotting raw cumulative TWR
    // made every range end at the same since-inception figure (e.g. +25%).
    const base = raw.length ? raw[0].timeWeightedReturn : 0;
    const series = raw.map(s => ({ date: s.date, twr: (1 + s.timeWeightedReturn) / (1 + base) - 1 }));
    // Info label: actual return over the visible window (matches the KPI card
    // and the chart endpoint, so all three never disagree).
    const infoEl = document.getElementById('range-info');
    const winRet = windowedTwr(current.timeWeightedReturnHistory, twrRange);
    if (series.length > 1 && winRet != null) {
      const sign = winRet >= 0 ? '+' : '';
      infoEl.innerHTML = 'Window return: <span style="color: var(--' + (winRet >= 0 ? 'green' : 'red') +
        ');">' + sign + (winRet * 100).toFixed(2) + '%</span> · ' + series.length + ' pts';
    } else {
      infoEl.textContent = series.length + ' point(s)';
    }
    renderLineChart('twr-chart', series,
      (item) => item.twr,
      (v) => fmtPct(v),
      'var(--blue)',
      { isPct: true });
  }

  function renderValueChart() {
    let valSeries = current.valuationHistory || [];
    if (twrRange !== 'ALL' && valSeries.length) {
      const last = new Date(valSeries[valSeries.length - 1].date);
      const cutoff = new Date(last);
      const RANGES = { '1W': 7, '1M': 30, '3M': 91, '6M': 183, '1Y': 365 };
      const days = RANGES[twrRange];
      if (days) {
        cutoff.setDate(cutoff.getDate() - days);
        valSeries = valSeries.filter(s => new Date(s.date) >= cutoff);
      }
    }
    const capitalSeries = buildCapitalSeries(current.transactions || []);
    const capAligned = alignCapitalToValuationDates(
      capitalSeries, valSeries.map(v => v.date),
    );

    const gapEl = document.getElementById('value-gap');
    if (valSeries.length && capAligned.length) {
      const lastVal = valSeries[valSeries.length - 1].valuation;
      const lastCap = capAligned[capAligned.length - 1].value;
      const gap = lastVal - lastCap;
      const cls = gap >= 0 ? 'green' : 'red';
      const sign = gap >= 0 ? '+' : '';
      const pct = lastCap > 0 ? ' (' + sign + (gap / lastCap * 100).toFixed(2) + '%)' : '';
      gapEl.innerHTML = 'Real return: <span style="color: var(--' + cls +
        '); font-weight: 700;">' + sign + fmtMoney(gap) + pct + '</span>';
    } else {
      gapEl.textContent = '—';
    }

    renderTwoLineChart('value-chart', valSeries, capAligned);
  }

  function renderTwoLineChart(svgId, mainSeries, refSeries) {
    const svg = document.getElementById(svgId);
    svg.innerHTML = '';
    if (!mainSeries || !mainSeries.length) {
      const W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height;
      svg.innerHTML = '<text x="' + (W / 2) + '" y="' + (H / 2) +
        '" text-anchor="middle" fill="var(--muted)">No data</text>';
      return;
    }
    const W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height;
    const M = { top: 14, right: 80, bottom: 30, left: 60 };
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;

    const pointsMain = mainSeries.map(s => ({ date: new Date(s.date), value: Number(s.valuation) || 0 }));
    const pointsRef  = (refSeries || []).map(s => ({ date: new Date(s.date), value: Number(s.value) || 0 }));
    const allYs = [...pointsMain.map(p => p.value), ...pointsRef.map(p => p.value)];
    const t0 = pointsMain[0].date.getTime();
    const t1 = pointsMain[pointsMain.length - 1].date.getTime();
    let minY = Math.min(0, ...allYs);
    let maxY = Math.max(...allYs, 1);
    const xRange = t1 - t0 || 1;
    const yRange = maxY - minY || 1;
    const X = (d) => M.left + ((d.getTime() - t0) / xRange) * innerW;
    const Y = (v) => M.top + innerH - ((v - minY) / yRange) * innerH;

    for (let i = 0; i <= 4; i++) {
      const y = M.top + innerH - (innerH * i / 4);
      const val = minY + yRange * i / 4;
      svg.innerHTML += '<line class="axis-line" x1="' + M.left + '" y1="' + y +
        '" x2="' + (M.left + innerW) + '" y2="' + y + '" stroke-dasharray="2,3" opacity="0.3"/>';
      svg.innerHTML += '<text x="' + (M.left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
        fmtMoney(val) + '</text>';
    }
    [t0, t0 + xRange / 2, t1].forEach(ts => {
      const x = M.left + ((ts - t0) / xRange) * innerW;
      const dStr = new Date(ts).toLocaleDateString('en-GB',
        { year: 'numeric', month: 'short', day: '2-digit' });
      svg.innerHTML += '<text x="' + x + '" y="' + (M.top + innerH + 18) +
        '" text-anchor="middle">' + dStr + '</text>';
    });

    let pathMain = '';
    pointsMain.forEach((p, i) => {
      const x = X(p.date), y = Y(p.value);
      pathMain += (i === 0 ? 'M ' + x + ' ' + y : ' L ' + x + ' ' + y);
    });
    const yBase = Y(minY);
    svg.innerHTML += '<path d="' + pathMain + ' L ' +
      X(pointsMain[pointsMain.length - 1].date) + ' ' + yBase + ' L ' +
      X(pointsMain[0].date) + ' ' + yBase + ' Z" fill="var(--blue)" opacity="0.08"/>';
    svg.innerHTML += '<path d="' + pathMain + '" fill="none" stroke="var(--blue)" stroke-width="2"/>';

    if (pointsRef.length) {
      let pathRef = '';
      pointsRef.forEach((p, i) => {
        const x = X(p.date), y = Y(p.value);
        pathRef += (i === 0 ? 'M ' + x + ' ' + y : ' L ' + x + ' ' + y);
      });
      svg.innerHTML += '<path d="' + pathRef + '" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="6,4"/>';
      const lastRef = pointsRef[pointsRef.length - 1];
      svg.innerHTML += '<text x="' + (X(lastRef.date) + 6) + '" y="' + (Y(lastRef.value) + 4) +
        '" fill="var(--muted)" style="font-weight:600; font-size: 11px;">' + fmtMoney(lastRef.value) + '</text>';
    }
    const lastMain = pointsMain[pointsMain.length - 1];
    svg.innerHTML += '<circle cx="' + X(lastMain.date) + '" cy="' + Y(lastMain.value) +
      '" r="3.5" fill="var(--blue)"/>';
    svg.innerHTML += '<text x="' + (X(lastMain.date) + 6) + '" y="' + (Y(lastMain.value) - 6) +
      '" fill="var(--blue)" style="font-weight:600; font-size: 11px;">' + fmtMoney(lastMain.value) + '</text>';
  }

  function renderLineChart(svgId, series, getValue, fmtTick, color, opts = {}) {
    const svg = document.getElementById(svgId);
    svg.innerHTML = '';
    if (!series || !series.length) {
      const W = svg.viewBox.baseVal.width || 600;
      const H = svg.viewBox.baseVal.height || 280;
      svg.innerHTML = '<text x="' + (W / 2) + '" y="' + (H / 2) +
        '" text-anchor="middle" fill="var(--muted)">No data</text>';
      return;
    }
    const W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height;
    const M = { top: 14, right: 60, bottom: 30, left: 60 };
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;

    const points = series.map(s => ({
      date: new Date(s.date),
      value: Number(getValue(s)) || 0,
    })).filter(p => !isNaN(p.date.getTime()));
    if (!points.length) return;
    const t0 = points[0].date.getTime();
    const t1 = points[points.length - 1].date.getTime();
    const ys = points.map(p => p.value);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (minY === maxY) { minY -= 1; maxY += 1; }
    if (opts.isPct && minY > 0) minY = 0;
    const xRange = t1 - t0 || 1;
    const yRange = maxY - minY || 1;

    const X = (d) => M.left + ((d.getTime() - t0) / xRange) * innerW;
    const Y = (v) => M.top + innerH - ((v - minY) / yRange) * innerH;

    for (let i = 0; i <= 4; i++) {
      const y = M.top + innerH - (innerH * i / 4);
      const val = minY + yRange * i / 4;
      svg.innerHTML += '<line class="axis-line" x1="' + M.left + '" y1="' + y +
        '" x2="' + (M.left + innerW) + '" y2="' + y + '" stroke-dasharray="2,3" opacity="0.3"/>';
      svg.innerHTML += '<text x="' + (M.left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
        fmtTick(val) + '</text>';
    }
    [t0, t0 + xRange / 2, t1].forEach(ts => {
      const x = M.left + ((ts - t0) / xRange) * innerW;
      const dStr = new Date(ts).toLocaleDateString('en-GB',
        { year: 'numeric', month: 'short', day: '2-digit' });
      svg.innerHTML += '<text x="' + x + '" y="' + (M.top + innerH + 18) +
        '" text-anchor="middle">' + dStr + '</text>';
    });
    if (opts.isPct && minY < 0) {
      const yZero = Y(0);
      svg.innerHTML += '<line x1="' + M.left + '" y1="' + yZero + '" x2="' + (M.left + innerW) +
        '" y2="' + yZero + '" stroke="var(--muted)" stroke-width="1" opacity="0.5"/>';
    }
    let path = '';
    points.forEach((p, i) => {
      const x = X(p.date), y = Y(p.value);
      path += (i === 0 ? 'M ' + x + ' ' + y : ' L ' + x + ' ' + y);
    });
    svg.innerHTML += '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
    const yBaseline = opts.isPct ? Y(0) : Y(minY);
    svg.innerHTML += '<path d="' + path + ' L ' + X(points[points.length - 1].date) + ' ' + yBaseline +
      ' L ' + X(points[0].date) + ' ' + yBaseline + ' Z" fill="' + color + '" opacity="0.10"/>';
    const last = points[points.length - 1];
    svg.innerHTML += '<circle cx="' + X(last.date) + '" cy="' + Y(last.value) + '" r="3.5" fill="' + color + '"/>';
    svg.innerHTML += '<text x="' + (X(last.date) + 6) + '" y="' + (Y(last.value) + 4) +
      '" fill="' + color + '" style="font-weight:600;">' + fmtTick(last.value) + '</text>';
  }

  function renderEtfTable() {
    const tbody = document.querySelector('#etf-table tbody');
    tbody.innerHTML = '';
    const classes = (current.latestAllocation && current.latestAllocation.assetClassAllocations) || [];
    const all = classes.flatMap(c => (c.eftAllocations || []).map(e => Object.assign({}, e, { _class: c.type })));
    if (!all.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--muted);">No underlying ETFs.</td></tr>';
      return;
    }
    all.sort((a, b) => (b.valuation || 0) - (a.valuation || 0));
    for (const e of all) {
      const sty = classStyle(e._class);
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><code style="color: var(--text); font-size: 13px;">' + escapeHtml(e.isin) + '</code></td>' +
        '<td><span class="badge ' + sty.badge + '">' + escapeHtml(e._class) + '</span></td>' +
        '<td>' + fmtPct(e.weight, { decimals: 2 }) + '</td>' +
        '<td>' + fmtMoney(e.valuation) + '</td>';
      tbody.appendChild(tr);
    }
  }

  function renderTxTable() {
    const tbody = document.querySelector('#tx-table tbody');
    tbody.innerHTML = '';
    const tx = [...(current.transactions || [])].sort((a, b) =>
      (b.bookingDate || '').localeCompare(a.bookingDate || ''));
    if (!tx.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--muted);">No transactions.</td></tr>';
      return;
    }
    for (const t of tx.slice(0, 50)) {
      const amt = Number(t.amount) || 0;
      const amtStyle = amt > 0 ? 'color: var(--green)' : amt < 0 ? 'color: var(--red)' : '';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + fmtDate(t.bookingDate) + '</td>' +
        '<td><span style="color: var(--muted); font-size: 12px;">' + escapeHtml(t.type || '—') + '</span></td>' +
        '<td>' + escapeHtml(t.description || '—') + '</td>' +
        '<td><span style="color: var(--muted); font-size: 12px;">' + escapeHtml(t.state || '—') + '</span></td>' +
        '<td style="' + amtStyle + '">' + fmtMoney(amt, t.currency || 'EUR') + '</td>';
      tbody.appendChild(tr);
    }
    if (tx.length > 50) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" style="text-align:center; color: var(--muted);">' +
        'Showing 50 most recent of ' + tx.length + ' total.</td>';
      tbody.appendChild(tr);
    }
  }

  function init() {
    if (!document.getElementById('sc-app')) return;
    routes = readRoutes();
    on('portfolio-picker', 'change', (e) => selectPortfolio(e.target.value));
    document.querySelectorAll('#range-pills button').forEach(btn => {
      btn.addEventListener('click', () => {
        twrRange = btn.dataset.range;
        document.querySelectorAll('#range-pills button').forEach(b =>
          b.classList.toggle('active', b === btn));
        if (current) { renderTwrChart(); renderValueChart(); }
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
