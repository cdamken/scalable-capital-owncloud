<?php
/**
 * JSON API — per-user data, config, update trigger, reset.
 *
 * Exit codes from python/fetch_wrapper.py (canonical, mirrored across the
 * 3 trios + TECHNICAL-PATTERNS.md #2):
 *    0  ok
 *   10  mfa_required   (cookies dead — Scalable's 2FA is push-only, user must re-login in Chrome)
 *   12  auth_failed
 *   20  api_error
 *   21  timeout
 *   30  config_error
 */

namespace OCA\ScalableCapital\Controller;

use OCA\ScalableCapital\Service\ScalableService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class ApiController extends Controller {

	// EXIT_* constants live on BaseOwnCloudService (inherited by
	// ScalableService) — single source of truth across all 3 trios.
	// Reference them as ScalableService::EXIT_* below.

	private $service;

	public function __construct(string $appName, IRequest $request, ScalableService $service) {
		parent::__construct($appName, $request);
		$this->service = $service;
	}

	/**
	 * @NoAdminRequired
	 */
	public function data(string $type): JSONResponse {
		// Whitelist allowed JSON file names — prevents path traversal even
		// though ScalableService::dataPath() also applies basename().
		$allowed = [
			'inventory', 'cash', 'interest', 'crypto', 'pending_orders',
			'watchlist', 'transactions', 'savings', 'savings_transactions',
		];
		if (!in_array($type, $allowed, true)) {
			return new JSONResponse(['error' => 'unknown type'], Http::STATUS_BAD_REQUEST);
		}
		$payload = $this->service->readJson("{$type}.json");
		if ($payload === null) {
			return new JSONResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse($payload);
	}

	/**
	 * @NoAdminRequired
	 */
	public function getConfig(): JSONResponse {
		return new JSONResponse([
			'configured' => $this->service->isConfigured(),
			'email'      => $this->service->getEmail(),
		]);
	}

	/**
	 * @NoAdminRequired
	 */
	public function setConfig(): JSONResponse {
		$body = json_decode(file_get_contents('php://input'), true) ?: [];
		$email = trim((string)($body['email'] ?? ''));
		if ($email === '') {
			return new JSONResponse(['error' => 'email required'], Http::STATUS_BAD_REQUEST);
		}
		$this->service->setEmail($email);
		return new JSONResponse(['status' => 'ok', 'email' => $email]);
	}

	/**
	 * @NoAdminRequired
	 */
	public function update(): JSONResponse {
		$result = $this->service->runFetch();
		$status = self::exitCodeToStatus($result['exitCode']);
		return new JSONResponse([
			'status'    => $status,
			'exit_code' => $result['exitCode'],
			'log'       => $result['log'],
		]);
	}

	/**
	 * @NoAdminRequired
	 */
	public function reset(): JSONResponse {
		$this->service->wipeUserData();
		return new JSONResponse(['status' => 'ok']);
	}

	// --------------------------------------------------------------------
	private static function exitCodeToStatus(int $code): string {
		return [
			ScalableService::EXIT_OK            => 'ok',
			ScalableService::EXIT_MFA_REQUIRED  => 'mfa_required',
			ScalableService::EXIT_MFA_INVALID   => 'mfa_invalid',
			ScalableService::EXIT_AUTH_FAILED   => 'auth_failed',
			ScalableService::EXIT_API_ERROR     => 'api_error',
			ScalableService::EXIT_TIMEOUT       => 'timeout',
			ScalableService::EXIT_CONFIG_ERROR  => 'config_error',
		][$code] ?? 'unknown_error';
	}
}
