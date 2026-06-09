<?php
/**
 * Routes for the Scalable Capital Portfolio app.
 *
 *   page#index       GET  /                    → portfolio dashboard
 *   api#data         GET  /data/{type}         → per-user JSON
 *   api#getConfig    GET  /api/config          → { configured: bool, email: string|null }
 *   api#setConfig    POST /api/config          → save { email } and trigger cookie import
 *   api#update       POST /api/update          → trigger refresh
 *   api#reset        POST /api/reset           → wipe per-user data
 */

return [
	'routes' => [
		['name' => 'page#index',     'url' => '/',                  'verb' => 'GET'],
		['name' => 'api#data',       'url' => '/data/{type}',       'verb' => 'GET'],
		['name' => 'api#getConfig',  'url' => '/api/config',        'verb' => 'GET'],
		['name' => 'api#setConfig',  'url' => '/api/config',        'verb' => 'POST'],
		['name' => 'api#update',     'url' => '/api/update',        'verb' => 'POST'],
		['name' => 'api#reset',      'url' => '/api/reset',         'verb' => 'POST'],
	],
];
