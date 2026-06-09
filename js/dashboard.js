/* Scalable Capital — ownCloud Dashboard JS.
 *
 * Mirrors the local Scalable-Capital-Dashboard/app/index.html script, but:
 *   1. URLs read from data-route-* attrs on #sc-app (no hardcoded paths)
 *   2. POSTs go through postJSON() which adds requesttoken: OC.requestToken (CSRF)
 *   3. All addEventListener calls go through null-safe on() helper
 *   4. Wrapped in IIFE to avoid polluting global scope
 *
 * See OWNCLOUD-PATCHES.md for the full catalog of allowed transformations.
 */

(function () {
	'use strict';

	const app = document.getElementById('sc-app');
	if (!app) return;

	const routes = {
		data:      app.dataset.routeData,
		config:    app.dataset.routeConfig,
		setConfig: app.dataset.routeSetConfig,
		update:    app.dataset.routeUpdate,
		reset:     app.dataset.routeReset,
	};

	const fmtMoney = (n, currency = 'EUR') => {
		if (n == null) return '—';
		return new Intl.NumberFormat('en-US', {
			style: 'currency', currency,
			minimumFractionDigits: 2, maximumFractionDigits: 2,
		}).format(n);
	};
	const fmtPct = (n) => {
		if (n == null) return '—';
		const v = (n * 100).toFixed(2);
		return (n >= 0 ? '+' : '') + v + '%';
	};
	const fmtQty = (n) => {
		if (n == null) return '—';
		return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n);
	};

	// null-safe addEventListener — see OWNCLOUD-PATCHES.md #3 + TECHNICAL-PATTERNS.md #10
	const on = (id, evt, fn) => {
		const el = document.getElementById(id);
		if (el) el.addEventListener(evt, fn);
	};

	function toast(message, kind = '') {
		const t = document.getElementById('sc-toast');
		if (!t) return;
		t.className = 'active ' + kind;
		const msg = document.getElementById('sc-toast-msg');
		if (msg) msg.textContent = message;
		if (kind === 'ok') {
			setTimeout(() => t.classList.remove('active'), 2200);
		}
	}

	async function getJSON(url) {
		const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
		if (!res.ok) return null;
		return res.json();
	}

	function postJSON(url, body = {}) {
		return fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json',
				'requesttoken': OC.requestToken,
			},
			body: JSON.stringify(body || {}),
		}).then(r => r.json());
	}

	function dataUrl(type) {
		return routes.data.replace('__TYPE__', type);
	}

	function setStaleness(ts) {
		const el = document.getElementById('sc-staleness');
		if (!el) return;
		if (!ts) { el.textContent = 'never updated'; el.className = 'staleness'; return; }
		const d = new Date(ts.replace(' ', 'T') + 'Z');
		const ageMin = (Date.now() - d.getTime()) / 60000;
		let cls = 'fresh'; let label = Math.round(ageMin) + 'm ago';
		if (ageMin > 60) { cls = 'warn'; label = Math.round(ageMin / 60) + 'h ago'; }
		if (ageMin > 1440) { cls = 'stale'; label = Math.round(ageMin / 1440) + 'd ago'; }
		el.textContent = 'Updated ' + label;
		el.className = 'staleness ' + cls;
	}

	async function render() {
		const cfg = await getJSON(routes.config);
		const setup = document.getElementById('sc-setup-state');
		const dash = document.getElementById('sc-dashboard-state');
		if (!cfg || !cfg.configured) {
			if (setup) setup.style.display = 'block';
			if (dash) dash.style.display = 'none';
			return;
		}
		if (setup) setup.style.display = 'none';
		if (dash) dash.style.display = 'block';

		const cash = await getJSON(dataUrl('cash'));
		const pending = await getJSON(dataUrl('pending_orders'));
		const inv = await getJSON(dataUrl('inventory'));

		if (cash && cash.buyingPower) {
			document.getElementById('sc-kpi-cash').textContent =
				fmtMoney(cash.buyingPower.cashBalance);
		}
		if (pending) {
			document.getElementById('sc-kpi-pending').textContent =
				String(pending.count != null ? pending.count : '—');
		}

		if (inv) {
			// Shape (live data): inv.portfolioGroups = {items: [{details, items: [Security]}]}
			// inv.ungroupedInventoryItems = {items: [Security]}
			const grouped = ((inv.portfolioGroups && inv.portfolioGroups.items) || [])
				.flatMap(g => g.items || []);
			const ungrouped = (inv.ungroupedInventoryItems && inv.ungroupedInventoryItems.items) || [];
			const allItems = [...grouped, ...ungrouped];
			let securitiesValue = 0;
			const tbody = document.querySelector('#sc-holdings-table tbody');
			tbody.innerHTML = '';
			if (!allItems.length) {
				tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--sc-muted);">No holdings.</td></tr>';
			}
			for (const sec of allItems) {
				const pos = (sec.inventory && sec.inventory.position) || {};
				const qty = (pos.filled || 0) + (pos.pending || 0) + (pos.blocked || 0);
				const tick = sec.quoteTick || {};
				const price = tick.midPrice;
				const value = price != null && qty != null ? price * qty : null;
				if (value != null) securitiesValue += value;
				const perf = (tick.performancesByTimeframe || []).find(p => p.timeframe === 'ONE_DAY');
				const pnl = perf ? perf.performance : null;
				const tr = document.createElement('tr');
				tr.innerHTML = '<td>' + (sec.name || '') + '</td>' +
				               '<td>' + (sec.isin || '') + '</td>' +
				               '<td>' + fmtQty(qty) + '</td>' +
				               '<td>' + fmtMoney(price, tick.currency || 'EUR') + '</td>' +
				               '<td>' + fmtMoney(value, tick.currency || 'EUR') + '</td>' +
				               '<td class="' + (pnl != null && pnl >= 0 ? 'pos' : 'neg') + '">' + fmtPct(pnl) + '</td>';
				tbody.appendChild(tr);
			}
			document.getElementById('sc-kpi-securities').textContent = fmtMoney(securitiesValue);
			const cashBal = (cash && cash.buyingPower && cash.buyingPower.cashBalance) || 0;
			document.getElementById('sc-kpi-total').textContent = fmtMoney(securitiesValue + cashBal);
		}
	}

	async function triggerUpdate() {
		toast('Fetching…');
		const res = await postJSON(routes.update);
		if (res.status === 'ok') {
			toast('Updated ✓', 'ok');
			await render();
		} else if (res.status === 'mfa_required') {
			toast('Cookies expired. Re-login in Chrome on your machine and re-upload cookies.', 'err');
		} else {
			toast('Update failed: ' + res.status, 'err');
			console.error(res);
		}
	}

	async function submitSetup() {
		const emailEl = document.getElementById('sc-setup-email');
		const email = emailEl ? emailEl.value.trim() : '';
		if (!email) { toast('Email required', 'err'); return; }
		const res = await postJSON(routes.setConfig, { email });
		if (res.status === 'ok') {
			toast('Saved ✓', 'ok');
			await render();
		} else {
			toast('Setup failed: ' + (res.error || 'unknown'), 'err');
		}
	}

	async function reset() {
		if (!confirm('Wipe your Scalable data on the server?')) return;
		await postJSON(routes.reset);
		await render();
	}

	document.addEventListener('DOMContentLoaded', () => {
		on('sc-update-btn', 'click', triggerUpdate);
		on('sc-setup-btn',  'click', submitSetup);
		on('sc-reset-btn',  'click', reset);
		render();
	});
})();
