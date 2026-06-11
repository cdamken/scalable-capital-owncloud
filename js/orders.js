/* global fmtMoney, fmtQty, fmtDateTime, on, escapeHtml, getJSON, readRoutes, dataUrl, refreshStaleness */
/**
 * Orders page — verbatim port of Scalable-Capital-Dashboard/app/orders.html
 * inline <script>. Patches per OWNCLOUD-PATCHES.md.
 */
(function () {
  'use strict';

  let routes;
  let allOrders = [];

  async function load() {
    await refreshStaleness(routes);
    const tx = await getJSON(dataUrl(routes, 'transactions'));
    if (!tx || !tx.transactions) {
      allOrders = [];
      render();
      return;
    }
    allOrders = tx.transactions
      .filter(t => t.type === 'SECURITY_TRANSACTION')
      .sort((a, b) => {
        const aPending = a.status === 'PENDING' ? 0 : 1;
        const bPending = b.status === 'PENDING' ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return (b.lastEventDateTime || '').localeCompare(a.lastEventDateTime || '');
      });
    render();
  }

  function render() {
    const q       = (document.getElementById('search').value || '').toLowerCase().trim();
    const sideF   = document.getElementById('side-filter').value;
    const statusF = document.getElementById('status-filter').value;
    const typeF   = document.getElementById('type-filter').value;

    const filtered = allOrders.filter(t => {
      if (sideF && t.side !== sideF) return false;
      if (statusF && t.status !== statusF) return false;
      if (typeF && t.securityTransactionType !== typeF) return false;
      if (q) {
        const blob = ((t.description || '') + ' ' + (t.isin || '')).toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });

    let count = filtered.length, bought = 0, sold = 0;
    for (const t of filtered) {
      const amt = Number(t.amount) || 0;
      if (t.side === 'BUY') bought += amt;
      else if (t.side === 'SELL') sold += amt;
    }
    const net = sold - bought;

    document.getElementById('kpi-count').textContent = String(count);
    document.getElementById('kpi-count-sub').textContent =
      allOrders.length === count ? 'all orders' : ('of ' + allOrders.length + ' total');
    document.getElementById('kpi-bought').textContent = fmtMoney(bought);
    document.getElementById('kpi-sold').textContent = fmtMoney(sold);
    const netEl = document.getElementById('kpi-net');
    netEl.textContent = fmtMoney(net);
    netEl.className = 'value ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : '');

    document.getElementById('row-count').textContent =
      count + ' order' + (count === 1 ? '' : 's');

    const tbody = document.querySelector('#orders-table tbody');
    tbody.innerHTML = '';
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--muted);">No orders match these filters.</td></tr>';
      return;
    }
    for (const t of filtered) {
      const tr = document.createElement('tr');
      if (t.status === 'PENDING') tr.classList.add('pending');
      const sideClass = t.side === 'BUY' ? 'buy' : t.side === 'SELL' ? 'sell' : '';
      const statusClass = (t.status || '').toLowerCase();
      const typeBadge = t.securityTransactionType === 'SAVINGS_PLAN'
        ? '<span class="badge savings_plan">SAVINGS</span>' : '—';
      tr.innerHTML =
        '<td>' + fmtDateTime(t.lastEventDateTime) + '</td>' +
        '<td>' + escapeHtml(t.description || '—') + '</td>' +
        '<td><code style="color: var(--muted); font-size: 12px;">' + escapeHtml(t.isin || '—') + '</code></td>' +
        '<td><span class="badge ' + sideClass + '">' + escapeHtml(t.side || '—') + '</span></td>' +
        '<td>' + typeBadge + '</td>' +
        '<td>' + fmtQty(t.quantity) + '</td>' +
        '<td>' + (t.amount != null ? fmtMoney(t.amount, t.currency || 'EUR') : '—') + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + escapeHtml(t.status || '—') + '</span></td>';
      tbody.appendChild(tr);
    }
  }

  function init() {
    if (!document.getElementById('sc-app')) return;
    routes = readRoutes();
    on('search', 'input', render);
    on('side-filter', 'change', render);
    on('status-filter', 'change', render);
    on('type-filter', 'change', render);
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
