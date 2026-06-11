<?php
/** @var array $_ */
$routes = $_['routes'];
/**
 * Verbatim port of Scalable-Capital-Dashboard/app/settings.html.
 *   - Inline <style> moved to css/dashboard.css (every selector prefixed #sc-app).
 *   - Inline <script> moved to js/settings.js (CSP).
 *   - Inline form/handlers re-wired via addEventListener.
 *   - POST /save_credentials → routes.setConfig (POST /api/config).
 *   - POST /reset → routes.reset; /check_session, /logout, /version not exposed
 *     in the owncloud port (button still present for parity; click yields a
 *     friendly "not available in this port" toast).
 *   - /setup_status, /DATA/wealth.json → routes.config + routes.data ('wealth').
 */
?>
<div id="sc-app" class="settings-page"
	data-route-index="<?php p($routes['index']); ?>"
	data-route-settings="<?php p($routes['settings']); ?>"
	data-route-orders="<?php p($routes['orders']); ?>"
	data-route-ledger="<?php p($routes['ledger']); ?>"
	data-route-dividends="<?php p($routes['dividends']); ?>"
	data-route-analytics="<?php p($routes['analytics']); ?>"
	data-route-wealth="<?php p($routes['wealth']); ?>"
	data-route-glossary="<?php p($routes['glossary']); ?>"
	data-route-data="<?php p($routes['data']); ?>"
	data-route-config="<?php p($routes['config']); ?>"
	data-route-set-config="<?php p($routes['setConfig']); ?>"
	data-route-update="<?php p($routes['update']); ?>"
	data-route-reset="<?php p($routes['reset']); ?>">

<div class="top-bar">
  <div class="brand"><span class="logo-box"></span> Scalable Capital</div>
  <nav>
    <a class="tab" href="<?php p($routes['index']); ?>">Portfolio</a>
    <a class="tab" href="<?php p($routes['analytics']); ?>">Analytics</a>
    <a class="tab" href="<?php p($routes['orders']); ?>">📋 Orders</a>
    <a class="tab" href="<?php p($routes['dividends']); ?>">💰 Dividends</a>
    <a class="tab" href="<?php p($routes['ledger']); ?>">📒 Ledger</a>
    <a class="tab" href="<?php p($routes['wealth']); ?>">🏦 Wealth</a>
    <a class="tab" href="<?php p($routes['glossary']); ?>">📖 Glossary</a>
    <a class="tab active" href="<?php p($routes['settings']); ?>">⚙ Settings</a>
  </nav>
  <div></div>
</div>

<div class="settings-grid">
  <div class="settings-side">
    <a href="#account" class="active">👤 Account</a>
    <a href="#session">🔐 Session</a>
    <a href="#data">💾 Data</a>
    <a href="#about">ℹ️ About</a>
  </div>

  <div>
    <!-- Account -->
    <div class="settings-section" id="account">
      <h3>👤 Scalable Capital account</h3>
      <p class="help">Register your account here, or switch to a different one. Login uses email + password + push approval on your phone — same flow as Scalable's website.</p>

      <div id="acc-summary" style="display: none; margin-bottom: 18px;">
        <div class="kv"><div class="k">Email</div><div class="v" id="acc-email">—</div></div>
        <div class="kv"><div class="k">User ID</div><div class="v" id="acc-userid">—</div></div>
        <div class="kv"><div class="k">Broker portfolios</div><div class="v" id="acc-broker">—</div></div>
        <div class="kv"><div class="k">Wealth portfolios</div><div class="v" id="acc-wealth">—</div></div>
        <div style="margin-top: 14px;">
          <button id="logout-btn" class="btn danger">Log out and delete credentials</button>
        </div>
      </div>

      <h4 style="font-size: 13px; color: var(--muted); margin: 18px 0 10px;
                 text-transform: uppercase; letter-spacing: 0.5px;"
          id="login-heading">Save Scalable credentials</h4>
      <form id="login-form" autocomplete="on">
        <div class="form-row">
          <label for="login-email">Email</label>
          <input id="login-email" type="email" placeholder="email@example.com"
                 autocomplete="username" required>
        </div>
        <div class="form-row">
          <label for="login-password">Password</label>
          <input id="login-password" type="password" placeholder="•••••••••••"
                 autocomplete="current-password" required>
        </div>
        <div style="margin-top: 14px;">
          <button id="login-btn" class="btn" type="submit">Save credentials</button>
          <span id="login-status" class="status-msg"></span>
        </div>
      </form>
      <p class="help" style="margin-top: 14px;">
        Credentials are stored encrypted in your ownCloud profile (password
        encrypted via <code>ICrypto</code>). No login or push approval happens
        here — that triggers automatically the next time you click <em>Update Now</em>.
      </p>
    </div>

    <!-- Session -->
    <div class="settings-section" id="session">
      <h3>🔐 Session</h3>
      <p class="help">Scalable's session cookies are HttpOnly. When they expire, just log in again above — one push approval and everything else carries over.</p>
      <button id="check-session-btn" class="btn ghost">Test current session</button>
      <span id="session-status" class="status-msg"></span>
    </div>

    <!-- Data -->
    <div class="settings-section" id="data">
      <h3>💾 Local data</h3>
      <p class="help">Downloaded JSONs (inventory, transactions, wealth, etc.) live per-user. Deleting them does NOT clear your cookies — it just forces a re-fetch on the next update.</p>
      <button id="clear-data-btn" class="btn ghost">Delete downloaded JSONs</button>
      <span id="clear-status" class="status-msg"></span>
    </div>

    <!-- About -->
    <div class="settings-section" id="about">
      <h3>ℹ️ About</h3>
      <div class="kv"><div class="k">sc-api version</div><div class="v muted" id="about-sc-version">checking…</div></div>
      <div class="kv"><div class="k">Endpoint</div><div class="v muted">https://de.scalable.capital/cockpit/graphql</div></div>
      <div class="kv"><div class="k">Auth</div><div class="v muted">Auth0 OAuth + push 2FA</div></div>
      <p class="help" style="margin-top: 14px;">
        Inspired by <a href="https://github.com/ffischbach/unofficial-scalable-capital-api" style="color: var(--blue);">ffischbach/unofficial-scalable-capital-api</a>
        and the Trade Republic + GBM México dashboard pattern.
      </p>
    </div>
  </div>
</div>

<div id="toast"><span id="toast-msg">…</span></div>

</div>
