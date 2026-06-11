/* global fmtMoney, fmtDate, on, escapeHtml, getJSON, readRoutes, dataUrl, refreshStaleness */
/**
 * Dividends page — verbatim port of Scalable-Capital-Dashboard/app/dividends.html
 * inline <script>. Patches per OWNCLOUD-PATCHES.md.
 */
(function () {
  'use strict';

  let routes;

  async function load() {
    await refreshStaleness(routes);
    const tx = await getJSON(dataUrl(routes, 'transactions'));
    const dividends = ((tx && tx.transactions) || [])
      .filter(t => t.type === 'CASH_TRANSACTION' && t.cashTransactionType === 'DISTRIBUTION')
      .sort((a, b) => (b.lastEventDateTime || '').localeCompare(a.lastEventDateTime || ''));
    render(dividends);
  }

  function render(dividends) {
    const total = dividends.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const thisYear = new Date().getFullYear();
    const ytd = dividends.filter(t => (t.lastEventDateTime || '').startsWith(String(thisYear)))
                         .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const securities = new Set(dividends.map(t => t.relatedIsin).filter(Boolean));
    const avg = dividends.length ? total / dividends.length : 0;

    document.getElementById('kpi-total').textContent = fmtMoney(total);
    document.getElementById('kpi-ytd').textContent   = fmtMoney(ytd);
    document.getElementById('kpi-ytd-year').textContent = 'Year ' + thisYear;
    document.getElementById('kpi-count').textContent = String(dividends.length);
    document.getElementById('kpi-securities').textContent =
      securities.size + ' ' + (securities.size === 1 ? 'security' : 'securities');
    document.getElementById('kpi-avg').textContent = fmtMoney(avg);

    const byYear = {};
    for (const t of dividends) {
      const year = (t.lastEventDateTime || '').slice(0, 4) || '—';
      byYear[year] = (byYear[year] || 0) + (Number(t.amount) || 0);
    }
    renderYearChart(byYear);

    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    const past12Months = dividends.filter(t => {
      const d = new Date(t.lastEventDateTime);
      return !isNaN(d.getTime()) && d >= oneYearAgo && d <= now;
    });
    const forecastTotal = past12Months.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const forecastBox = document.getElementById('forecast-box');
    if (past12Months.length > 0) {
      forecastBox.style.display = 'block';
      document.getElementById('forecast-value').textContent = fmtMoney(forecastTotal);
      const distinctSecurities = new Set(past12Months.map(t => t.relatedIsin).filter(Boolean)).size;
      document.getElementById('forecast-sub').textContent =
        'Based on ' + past12Months.length + ' payment' + (past12Months.length === 1 ? '' : 's') +
        ' across ' + distinctSecurities + ' securit' + (distinctSecurities === 1 ? 'y' : 'ies') +
        ' in the last 365 days. Assumes payouts continue at the same rate — does NOT account for position changes, dividend cuts, or new holdings.';
    } else {
      forecastBox.style.display = 'none';
    }

    const bySecurity = {};
    for (const t of dividends) {
      const isin = t.relatedIsin || '—';
      const key = isin;
      if (!bySecurity[key]) {
        bySecurity[key] = {
          isin, name: t.description || '—',
          count: 0, total: 0, last: t.lastEventDateTime || '',
        };
      }
      bySecurity[key].count += 1;
      bySecurity[key].total += Number(t.amount) || 0;
      if ((t.lastEventDateTime || '') > bySecurity[key].last) {
        bySecurity[key].last = t.lastEventDateTime;
      }
    }
    const secRows = Object.values(bySecurity).sort((a, b) => b.total - a.total);
    const secTbody = document.querySelector('#by-security-table tbody');
    secTbody.innerHTML = '';
    if (!secRows.length) {
      secTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--muted);">No distributions yet.</td></tr>';
    } else {
      for (const r of secRows) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(r.name) + '</td>' +
          '<td><code style="color: var(--muted); font-size: 12px;">' + escapeHtml(r.isin) + '</code></td>' +
          '<td>' + r.count + '</td>' +
          '<td>' + fmtDate(r.last) + '</td>' +
          '<td class="amount-pos">' + fmtMoney(r.total) + '</td>';
        secTbody.appendChild(tr);
      }
    }

    const allTbody = document.querySelector('#all-table tbody');
    allTbody.innerHTML = '';
    if (!dividends.length) {
      allTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--muted);">No distributions yet.</td></tr>';
    } else {
      for (const t of dividends) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + fmtDate(t.lastEventDateTime) + '</td>' +
          '<td>' + escapeHtml(t.description || '—') + '</td>' +
          '<td><code style="color: var(--muted); font-size: 12px;">' + escapeHtml(t.relatedIsin || '—') + '</code></td>' +
          '<td style="color: var(--muted);">Distribution</td>' +
          '<td class="amount-pos">' + fmtMoney(t.amount, t.currency || 'EUR') + '</td>';
        allTbody.appendChild(tr);
      }
    }
  }

  function renderYearChart(byYear) {
    const svg = document.getElementById('year-chart');
    svg.innerHTML = '';
    const years = Object.keys(byYear).sort();
    if (!years.length) {
      svg.innerHTML = '<text x="300" y="140" text-anchor="middle">No data</text>';
      return;
    }
    const values = years.map(y => byYear[y]);
    const maxV = Math.max(...values, 1);
    const W = 600, H = 280;
    const M = { top: 20, right: 20, bottom: 40, left: 60 };
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;
    const barW = innerW / years.length * 0.65;
    const gap  = innerW / years.length * 0.35;

    svg.innerHTML += '<line class="axis-line" x1="' + M.left + '" y1="' + (M.top + innerH) +
      '" x2="' + (M.left + innerW) + '" y2="' + (M.top + innerH) + '"/>';
    for (let i = 0; i <= 4; i++) {
      const y = M.top + innerH - (innerH * i / 4);
      const val = maxV * i / 4;
      svg.innerHTML += '<line class="axis-line" x1="' + M.left + '" y1="' + y +
        '" x2="' + (M.left + innerW) + '" y2="' + y + '" stroke-dasharray="2,3" opacity="0.4"/>';
      svg.innerHTML += '<text x="' + (M.left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
        fmtMoney(val) + '</text>';
    }
    years.forEach((year, i) => {
      const v = byYear[year];
      const h = v / maxV * innerH;
      const x = M.left + (innerW / years.length) * i + gap / 2;
      const y = M.top + innerH - h;
      svg.innerHTML += '<rect class="bar" x="' + x + '" y="' + y + '" width="' + barW +
        '" height="' + h + '" rx="4"><title>' + year + ': ' + fmtMoney(v) + '</title></rect>';
      svg.innerHTML += '<text class="bar-label" x="' + (x + barW / 2) + '" y="' + (y - 6) +
        '" text-anchor="middle">' + fmtMoney(v) + '</text>';
      svg.innerHTML += '<text x="' + (x + barW / 2) + '" y="' + (M.top + innerH + 18) +
        '" text-anchor="middle">' + year + '</text>';
    });
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
