<?php
/**
 * Portfolio page — scoped to #sc-app.
 *
 * Per OWNCLOUD-PATCHES.md:
 *   - All fetch URLs read from data-route-* attrs on #sc-app
 *   - All event handlers wired in js/dashboard.js via null-safe on() helper
 *   - All CSS selectors prefixed `#sc-app .xxx`
 *   - No inline <script>; relies on the file loaded by PageController
 */
?>
<div id="sc-app"
     data-route-index="<?php p($_['routes']['index']); ?>"
     data-route-data="<?php p($_['routes']['data']); ?>"
     data-route-config="<?php p($_['routes']['config']); ?>"
     data-route-set-config="<?php p($_['routes']['setConfig']); ?>"
     data-route-update="<?php p($_['routes']['update']); ?>"
     data-route-reset="<?php p($_['routes']['reset']); ?>">

  <div class="top-bar">
    <div class="brand"><span class="logo-box"></span> Scalable Capital</div>
    <nav>
      <a class="tab active" href="<?php p($_['routes']['index']); ?>">Portafolio</a>
    </nav>
    <div class="actions">
      <span id="sc-staleness" class="staleness">never updated</span>
      <button id="sc-update-btn" class="btn btn-primary">⟳ Actualizar</button>
      <button id="sc-reset-btn" class="btn">Reset</button>
    </div>
  </div>

  <div id="sc-setup-state" style="display: none;">
    <div class="empty-state">
      <h2>Welcome to Scalable Capital</h2>
      <p>First-time setup — register your Scalable login email here, then
         upload your session cookies (exported from Chrome on your own machine
         via the local <code>sc-api</code> CLI).</p>
      <p style="margin: 20px 0;">
        <input id="sc-setup-email" placeholder="email@example.com"
               class="sc-input" type="email">
        <button id="sc-setup-btn" class="btn btn-primary">Save email</button>
      </p>
      <p style="font-size: 12px; color: var(--muted);">
        Cookies upload UI is pending — see BACKLOG.md.
      </p>
    </div>
  </div>

  <div id="sc-dashboard-state" style="display: none;">
    <div class="grid">
      <div class="card"><div class="label">Total value</div><div class="value" id="sc-kpi-total">—</div></div>
      <div class="card"><div class="label">Cash</div><div class="value" id="sc-kpi-cash">—</div></div>
      <div class="card"><div class="label">Securities</div><div class="value" id="sc-kpi-securities">—</div></div>
      <div class="card"><div class="label">Pending orders</div><div class="value" id="sc-kpi-pending">—</div></div>
    </div>

    <h2 style="margin-top: 32px; font-size: 18px;">Holdings</h2>
    <table id="sc-holdings-table">
      <thead><tr>
        <th>Name</th><th>ISIN</th><th>Position</th>
        <th>Price</th><th>Value</th><th>P&amp;L %</th>
      </tr></thead>
      <tbody><tr><td colspan="6" style="text-align:center; color: var(--muted);">
        Click <em>Actualizar</em> to fetch your portfolio.
      </td></tr></tbody>
    </table>
  </div>

  <div id="sc-toast"><span id="sc-toast-msg">…</span></div>
</div>
