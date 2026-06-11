<?php
/**
 * Routes for the Scalable Capital Portfolio app.
 *
 *   page#index       GET  /                    → portfolio dashboard
 *   page#settings    GET  /settings            → credentials + session + about
 *   page#orders      GET  /orders              → order history
 *   page#ledger      GET  /ledger              → cash movements
 *   page#dividends   GET  /dividends           → distributions
 *   page#analytics   GET  /analytics           → XIRR / allocation / charts
 *   page#wealth      GET  /wealth              → roboadvisor detail
 *   page#glossary    GET  /glossary            → term reference
 *   api#data         GET  /data/{type}         → per-user JSON
 *   api#getConfig    GET  /api/config          → { configured: bool, email: string|null }
 *   api#setConfig    POST /api/config          → save { email, password } (password encrypted)
 *   api#update       POST /api/update          → trigger refresh (push 2FA on cookie death)
 *   api#reset        POST /api/reset           → wipe per-user data (+ creds unless {wipe_data_only})
 *   api#exportCsv    GET  /export/{kind}.csv   → orders / ledger / dividends / holdings / wealth
 */

return [
	'routes' => [
		['name' => 'page#index',     'url' => '/',                  'verb' => 'GET'],
		['name' => 'page#settings',  'url' => '/settings',          'verb' => 'GET'],
		['name' => 'page#orders',    'url' => '/orders',            'verb' => 'GET'],
		['name' => 'page#ledger',    'url' => '/ledger',            'verb' => 'GET'],
		['name' => 'page#dividends', 'url' => '/dividends',         'verb' => 'GET'],
		['name' => 'page#analytics', 'url' => '/analytics',         'verb' => 'GET'],
		['name' => 'page#wealth',    'url' => '/wealth',            'verb' => 'GET'],
		['name' => 'page#glossary',  'url' => '/glossary',          'verb' => 'GET'],
		['name' => 'api#data',       'url' => '/data/{type}',       'verb' => 'GET'],
		['name' => 'api#getConfig',  'url' => '/api/config',        'verb' => 'GET'],
		['name' => 'api#setConfig',  'url' => '/api/config',        'verb' => 'POST'],
		['name' => 'api#update',     'url' => '/api/update',        'verb' => 'POST'],
		['name' => 'api#reset',      'url' => '/api/reset',         'verb' => 'POST'],
		['name' => 'api#exportCsv',  'url' => '/export/{kind}.csv', 'verb' => 'GET'],
	],
];
