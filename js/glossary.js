/* global refreshStaleness, readRoutes */
/**
 * Glossary page — verbatim port of Scalable-Capital-Dashboard/app/glossary.html.
 * The upstream page is static (no <script> block). update_flow.js handles the
 * staleness chip + Update Now button if present. Keep this file as a no-op
 * placeholder so PageController's $scriptMap entry doesn't 404.
 */
(function () {
  'use strict';
  // No page-local logic needed — chrome (staleness + Update Now) lives in
  // update_flow.js, which already runs because main.php is the only template
  // setting data-update-flow-owner="page".
})();
