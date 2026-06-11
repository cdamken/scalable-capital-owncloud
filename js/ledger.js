/* global fmtMoney, fmtMoneySigned, fmtDate, on, escapeHtml, getJSON, readRoutes, dataUrl, refreshStaleness */
/**
 * Ledger page — verbatim port of Scalable-Capital-Dashboard/app/ledger.html
 * inline <script>. Patches per OWNCLOUD-PATCHES.md.
 */
(function () {
  'use strict';

  const IN_TYPES   = new Set(['DEPOSIT', 'TAX_RETURN', 'INTEREST']);
  const OUT_TYPES  = new Set(['WITHDRAWAL', 'TAX', 'FEE']);
  const DIST_TYPES = new Set(['DISTRIBUTION']);

  let routes;
  let allTx = [];

  async function load() {
    await refreshStaleness(routes);
    const tx = await getJSON(dataUrl(routes, 'transactions'));
    if (!tx || !tx.transactions) { allTx = []; render(); return; }
    allTx = tx.transactions
      .filter(t => t.type === 'CASH_TRANSACTION')
      .sort((a, b) => (b.lastEventDateTime || '').localeCompare(a.lastEventDateTime || ''));
    render();
  }

  function render() {
    const q     = (document.getElementById('search').value || '').toLowerCase().trim();
    const typeF = document.getElementById('type-filter').value;

    const filtered = allTx.filter(t => {
      const ct = t.cashTransactionType || '';
      if (typeF && ct !== typeF) return false;
      if (q) {
        const blob = ((t.description || '') + ' ' + (t.relatedIsin || '')).toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });

    let moneyIn = 0, moneyOut = 0, distributions = 0, distCount = 0;
    for (const t of filtered) {
      const amt = Number(t.amount) || 0;
      const ct = t.cashTransactionType || '';
      if (IN_TYPES.has(ct))   moneyIn  += amt;
      if (OUT_TYPES.has(ct))  moneyOut += Math.abs(amt);
      if (DIST_TYPES.has(ct)) { distributions += amt; distCount += 1; }
    }
    const net = moneyIn - moneyOut + distributions;

    document.getElementById('kpi-in').textContent      = fmtMoney(moneyIn);
    document.getElementById('kpi-out').textContent     = '−' + fmtMoney(moneyOut).replace('−', '');
    document.getElementById('kpi-distrib').textContent = fmtMoney(distributions);
    document.getElementById('kpi-distrib-count').textContent =
      distCount + ' payment' + (distCount === 1 ? '' : 's');
    const netEl = document.getElementById('kpi-net');
    netEl.textContent = fmtMoneySigned(net, 'EUR', true);
    netEl.className = 'value ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : '');
    document.getElementById('kpi-count').textContent = String(filtered.length);
    document.getElementById('kpi-count-sub').textContent =
      allTx.length === filtered.length ? 'all cash movements' : ('of ' + allTx.length + ' total');
    document.getElementById('row-count').textContent =
      filtered.length + ' ' + (filtered.length === 1 ? 'entry' : 'entries');

    const tbody = document.querySelector('#ledger-table tbody');
    tbody.innerHTML = '';
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--muted);">No entries match these filters.</td></tr>';
      return;
    }
    for (const t of filtered) {
      const ct = (t.cashTransactionType || 'UNKNOWN').toLowerCase();
      const amt = Number(t.amount) || 0;
      const amtClass = amt > 0 ? 'amount-pos' : amt < 0 ? 'amount-neg' : 'amount-zero';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + fmtDate(t.lastEventDateTime) + '</td>' +
        '<td><span class="badge ' + ct + '">' + escapeHtml(t.cashTransactionType || '—') + '</span></td>' +
        '<td>' + escapeHtml(t.description || '—') + '</td>' +
        '<td><code style="color: var(--muted); font-size: 12px;">' + escapeHtml(t.relatedIsin || '—') + '</code></td>' +
        '<td class="' + amtClass + '">' + fmtMoneySigned(amt, t.currency || 'EUR', true) + '</td>' +
        '<td><span class="badge ' + escapeHtml((t.status || '').toLowerCase()) + '">' + escapeHtml(t.status || '—') + '</span></td>';
      tbody.appendChild(tr);
    }
  }

  function init() {
    if (!document.getElementById('sc-app')) return;
    routes = readRoutes();
    on('search', 'input', render);
    on('type-filter', 'change', render);
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
