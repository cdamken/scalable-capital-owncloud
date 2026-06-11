/* global OC, fmtMoney, fmtPct, fmtQty, on, escapeHtml, getJSON, postJSON, readRoutes, dataUrl, refreshStaleness, setStaleness, showToast */
/**
 * Portfolio (main) page — verbatim port of Scalable-Capital-Dashboard/app/index.html.
 *
 * Patches from OWNCLOUD-PATCHES.md:
 *   - URLs read from data-route-* attrs on #sc-app (no /setup_status, /progress,
 *     /DATA/*.json hardcoded paths).
 *   - postJSON helper adds CSRF requesttoken header.
 *   - Inline on* handlers stripped; addEventListener via null-safe on().
 *   - IIFE wrapper, 'use strict'.
 *
 * dashboard.js owns its own Update Now via #update-btn — main.php sets
 * data-update-flow-owner="page" so the shared update_flow.js doesn't double-bind.
 */
(function () {
  'use strict';

  const routes = readRoutes();
  let allHoldings = [];
  let sortKey = 'value';
  let sortDir = 'desc';

  async function render() {
    // Configured? Yes → show dashboard, No → show setup CTA.
    const status = await getJSON(routes.config);
    if (!status || !status.configured) {
      const su = document.getElementById('setup-state');
      const ds = document.getElementById('dashboard-state');
      if (su) su.style.display = 'block';
      if (ds) ds.style.display = 'none';
      return;
    }
    const su = document.getElementById('setup-state');
    const ds = document.getElementById('dashboard-state');
    if (su) su.style.display = 'none';
    if (ds) ds.style.display = 'block';

    await refreshStaleness(routes);

    const cash    = await getJSON(dataUrl(routes, 'cash'));
    const pending = await getJSON(dataUrl(routes, 'pending_orders'));
    const inv     = await getJSON(dataUrl(routes, 'inventory'));
    const wealth  = await getJSON(dataUrl(routes, 'wealth'));

    if (cash && cash.buyingPower) {
      document.getElementById('kpi-cash').textContent =
        fmtMoney(cash.buyingPower.cashBalance);
    }

    // Wealth display
    let wealthTotal = 0;
    const wealthTbody = document.querySelector('#wealth-table tbody');
    if (wealth && Array.isArray(wealth) && wealth.length) {
      wealthTbody.innerHTML = '';
      for (const w of wealth) {
        if (typeof w.valuation === 'number') wealthTotal += w.valuation;
        const cancelled = (w.invested === false) || (w.funded === false);
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(w.name || '—') + '</td>' +
          '<td>' + escapeHtml(w.portfolio_type || '—') + '</td>' +
          '<td>' + escapeHtml(w.risk_category || '—') + '</td>' +
          '<td>' + (w.funded ? '✓' : '—') + '</td>' +
          '<td style="color: ' + (cancelled ? 'var(--muted)' : 'var(--green)') + ';">' +
            (cancelled ? 'cancelled' : 'active') + '</td>' +
          '<td>' + fmtMoney(w.valuation) + '</td>';
        wealthTbody.appendChild(tr);
      }
    } else if (wealthTbody) {
      wealthTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--muted);">No wealth portfolios.</td></tr>';
    }
    const kpiWealth = document.getElementById('kpi-wealth');
    if (kpiWealth) kpiWealth.textContent = fmtMoney(wealthTotal);

    const pendingLabel = document.getElementById('broker-pending-label');
    if (pending && pendingLabel) {
      pendingLabel.textContent = pending.count
        ? '(' + pending.count + ' pending order' + (pending.count === 1 ? '' : 's') + ')'
        : '';
    }

    if (inv) {
      // Shape (live data 2026-06-06):
      //   inv.portfolioGroups         = { id, items: [ {details, items: [Security]}, ... ] }
      //   inv.ungroupedInventoryItems = { id, items: [Security] }
      const groupedSecurities = ((inv.portfolioGroups && inv.portfolioGroups.items) || [])
        .flatMap(g => g.items || []);
      const ungroupedSecurities = (inv.ungroupedInventoryItems && inv.ungroupedInventoryItems.items) || [];
      const allItems = [...groupedSecurities, ...ungroupedSecurities];

      allHoldings = allItems.map(sec => {
        const pos = (sec.inventory && sec.inventory.position) || {};
        const qty = (pos.filled || 0) + (pos.pending || 0) + (pos.blocked || 0);
        const tick = sec.quoteTick || {};
        const price = tick.midPrice;
        const value = price != null && qty != null ? price * qty : null;
        const perf = (tick.performancesByTimeframe || []).find(p => p.timeframe === 'ONE_DAY');
        const pnl = perf ? perf.performance : null;
        return {
          name: sec.name || '',
          isin: sec.isin || '',
          wkn: sec.wkn || '',
          type: sec.type || '',
          qty, price, value, pnl,
          currency: tick.currency || 'EUR',
          isOutdated: tick.isOutdated,
          fifoPrice: pos.fifoPrice,
          filled: pos.filled, blocked: pos.blocked, pending: pos.pending,
          sellableByVenue: pos.sellableByVenue || [],
          savingsPlan: sec.inventory && sec.inventory.savingsPlan,
          partnerType: sec.partnerType,
          isSustainable: sec.isSustainable,
          isOnWatchlist: sec.isOnWatchlist,
          numberOfPendingOrders: sec.numberOfPendingOrders,
          quoteTick: tick,
          raw: sec,
        };
      });

      const securitiesValue = allHoldings.reduce(
        (s, h) => s + (h.value != null ? h.value : 0), 0);
      document.getElementById('kpi-securities').textContent = fmtMoney(securitiesValue);
      const cashBal = (cash && cash.buyingPower && cash.buyingPower.cashBalance) || 0;
      document.getElementById('kpi-total').textContent =
        fmtMoney(securitiesValue + cashBal + wealthTotal);

      // Concentration warnings (against total broker securities value)
      const warningsDiv = document.getElementById('concentration-warnings');
      warningsDiv.innerHTML = '';
      if (securitiesValue > 0 && allHoldings.length > 0) {
        const sorted = [...allHoldings].filter(h => h.value != null)
          .sort((a, b) => b.value - a.value);
        const top1Pct = sorted[0].value / securitiesValue;
        const top5Pct = sorted.slice(0, 5).reduce((s, h) => s + h.value, 0) / securitiesValue;
        if (top1Pct >= 0.50) {
          warningsDiv.innerHTML += '<div class="warning red">⚠️ <strong>' + escapeHtml(sorted[0].name) +
            '</strong> is ' + (top1Pct * 100).toFixed(1) + '% of your Broker holdings — heavy single-name concentration.</div>';
        } else if (top1Pct >= 0.30) {
          warningsDiv.innerHTML += '<div class="warning">⚠️ <strong>' + escapeHtml(sorted[0].name) +
            '</strong> is ' + (top1Pct * 100).toFixed(1) + '% of your Broker holdings.</div>';
        }
        if (top5Pct >= 0.85) {
          warningsDiv.innerHTML += '<div class="warning red">⚠️ Top 5 holdings are ' +
            (top5Pct * 100).toFixed(1) + '% of your Broker portfolio — very concentrated.</div>';
        } else if (top5Pct >= 0.70) {
          warningsDiv.innerHTML += '<div class="warning">ℹ️ Top 5 holdings are ' +
            (top5Pct * 100).toFixed(1) + '% of your Broker portfolio.</div>';
        }
      }

      renderHoldingsTable();
    }
  }

  function renderHoldingsTable() {
    const q = (document.getElementById('holdings-search')?.value || '').toLowerCase().trim();
    let rows = allHoldings.filter(h => {
      if (!q) return true;
      return (h.name + ' ' + h.isin + ' ' + h.wkn).toLowerCase().includes(q);
    });
    rows.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const an = av == null ? -Infinity : (typeof av === 'string' ? av.toLowerCase() : av);
      const bn = bv == null ? -Infinity : (typeof bv === 'string' ? bv.toLowerCase() : bv);
      const cmp = an < bn ? -1 : an > bn ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    const tbody = document.querySelector('#holdings-table tbody');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--muted);">No holdings match.</td></tr>';
    }
    for (const h of rows) {
      const tr = document.createElement('tr');
      tr.dataset.isin = h.isin;
      tr.innerHTML =
        '<td>' + escapeHtml(h.name) + '</td>' +
        '<td><code style="color: var(--muted); font-size: 12px;">' + escapeHtml(h.isin) + '</code></td>' +
        '<td>' + fmtQty(h.qty) + '</td>' +
        '<td>' + fmtMoney(h.price, h.currency) + '</td>' +
        '<td>' + fmtMoney(h.value, h.currency) + '</td>' +
        '<td class="' + (h.pnl != null && h.pnl >= 0 ? 'pos' : 'neg') + '">' + fmtPct(h.pnl) + '</td>';
      tr.addEventListener('click', () => openPositionModal(h));
      tbody.appendChild(tr);
    }
    document.getElementById('holdings-count').textContent =
      rows.length + ' of ' + allHoldings.length;

    document.querySelectorAll('#holdings-table th.sortable').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === sortKey) th.classList.add('sort-' + sortDir);
    });
  }

  function openPositionModal(h) {
    document.getElementById('modal-name').textContent = h.name || '—';
    document.getElementById('modal-isin').textContent =
      h.isin + (h.wkn ? '  ·  WKN ' + h.wkn : '') + (h.type ? '  ·  ' + h.type : '');
    const dl = document.getElementById('modal-body');
    const venuesText = (h.sellableByVenue || [])
      .map(v => v.venue + ': ' + fmtQty(v.sellable)).join(', ') || '—';
    const sp = h.savingsPlan;
    const spText = sp
      ? fmtMoney(sp.amount) + ' every ' + sp.frequency + ' (day ' + sp.dayOfTheMonth +
        ') — next: ' + ((sp.nextExecutionDate && sp.nextExecutionDate.date) || '—')
      : '—';
    const pricePerf = h.quoteTick.performancesByTimeframe || [];
    dl.innerHTML =
      '<dt>Position</dt><dd>' + fmtQty(h.qty) +
        ' (filled ' + fmtQty(h.filled) + ' · pending ' + fmtQty(h.pending) +
        ' · blocked ' + fmtQty(h.blocked) + ')</dd>' +
      '<dt>Current price</dt><dd>' + fmtMoney(h.price, h.currency) +
        (h.isOutdated ? ' <span style="color: var(--amber); font-size:11px;">⚠ outdated</span>' : '') + '</dd>' +
      '<dt>FIFO cost</dt><dd>' + fmtMoney(h.fifoPrice, h.currency) + '</dd>' +
      '<dt>Value</dt><dd>' + fmtMoney(h.value, h.currency) + '</dd>' +
      '<dt>Sellable by venue</dt><dd style="font-size: 12px; color: var(--muted);">' + escapeHtml(venuesText) + '</dd>' +
      '<dt>Savings plan</dt><dd>' + escapeHtml(spText) + '</dd>' +
      '<dt>Partner type</dt><dd>' + escapeHtml(h.partnerType || '—') + '</dd>' +
      '<dt>Pending orders</dt><dd>' + (h.numberOfPendingOrders || 0) + '</dd>' +
      '<dt>Performance (TWR)</dt><dd style="font-size: 12px;">' +
        (pricePerf.map(p => p.timeframe + ': ' + fmtPct(p.performance) +
          ' (' + fmtMoney(p.simpleAbsoluteReturn, h.currency) + ')').join('<br>') || '—') +
      '</dd>';
    document.getElementById('position-modal').classList.add('active');
  }

  function closeModal() {
    document.getElementById('position-modal').classList.remove('active');
  }

  async function triggerUpdate() {
    const btn = document.getElementById('update-btn');
    if (btn) btn.disabled = true;
    showToast('📱 Fetching… if push appears on your phone, tap Approve. This can take up to 2 min.');
    try {
      const res = await postJSON(routes.update);
      if (res && res.status === 'ok') {
        showToast('Updated ✓', 'ok');
        await render();
      } else if (res && (res.status === 'auth_required' || res.status === 'mfa_required')) {
        showToast('Push approval timed out — try Update Now again and tap Approve faster on your phone.', 'err');
        console.error(res);
      } else {
        const msg = (res && res.detail) ? res.detail : ((res && res.status) || 'unknown');
        showToast('Update failed: ' + msg, 'err');
        console.error(res);
      }
    } catch (e) {
      showToast('Update failed: ' + String(e), 'err');
      console.error(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function init() {
    if (!document.getElementById('sc-app')) return;
    on('update-btn', 'click', triggerUpdate);
    on('holdings-search', 'input', renderHoldingsTable);
    on('modal-close-btn', 'click', closeModal);
    on('position-modal', 'click', (e) => {
      if (e.target && e.target.id === 'position-modal') closeModal();
    });
    document.querySelectorAll('#holdings-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDir = (key === 'name' || key === 'isin') ? 'asc' : 'desc';
        }
        renderHoldingsTable();
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
