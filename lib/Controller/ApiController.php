<?php
/**
 * JSON endpoints used by the dashboard JS. Mirrors TR's ApiController shape:
 *
 *   GET  /data/{type}      → per-user JSON file
 *   GET  /api/config       → { configured, email }
 *   POST /api/config       → { email, password }   (password encrypted via ICrypto)
 *   POST /api/update       → triggers fetch_wrapper.py (push 2FA on first run / cookie death)
 *   POST /api/reset        → wipe credentials + data dir
 *   GET  /export/{kind}.csv → per-page CSV download (orders/ledger/dividends/holdings)
 */

namespace OCA\ScalableCapital\Controller;

use OCA\ScalableCapital\Service\ScalableService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class ApiController extends Controller {

	private $service;

	public function __construct(string $appName, IRequest $request, ScalableService $service) {
		parent::__construct($appName, $request);
		$this->service = $service;
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function data(string $type): Http\Response {
		$allowed = [
			'inventory'           => ['file' => 'inventory.json',           'ct' => 'application/json'],
			'cash'                => ['file' => 'cash.json',                'ct' => 'application/json'],
			'interest'            => ['file' => 'interest.json',            'ct' => 'application/json'],
			'crypto'              => ['file' => 'crypto.json',              'ct' => 'application/json'],
			'pending_orders'      => ['file' => 'pending_orders.json',      'ct' => 'application/json'],
			'watchlist'           => ['file' => 'watchlist.json',           'ct' => 'application/json'],
			'transactions'        => ['file' => 'transactions.json',        'ct' => 'application/json'],
			'savings'             => ['file' => 'savings.json',             'ct' => 'application/json'],
			'savings_transactions' => ['file' => 'savings_transactions.json', 'ct' => 'application/json'],
			'wealth'              => ['file' => 'wealth.json',              'ct' => 'application/json'],
			'wealth_detail'       => ['file' => 'wealth_detail.json',       'ct' => 'application/json'],
			'broker_overview'     => ['file' => 'broker_overview.json',     'ct' => 'application/json'],
			'last_update'         => ['file' => 'last_update.json',         'ct' => 'application/json'],
		];
		if (!isset($allowed[$type])) {
			return new JSONResponse(['error' => 'unknown type'], Http::STATUS_NOT_FOUND);
		}
		$path = $this->service->dataPath($allowed[$type]['file']);
		if (!is_file($path)) {
			return new JSONResponse(['error' => 'not yet generated'], Http::STATUS_NOT_FOUND);
		}
		$body = file_get_contents($path);
		$response = new DataDisplayResponse($body, Http::STATUS_OK, ['Content-Type' => $allowed[$type]['ct']]);
		$response->addHeader('Cache-Control', 'no-store, must-revalidate');
		$response->addHeader('Pragma', 'no-cache');
		return $response;
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function getConfig(): JSONResponse {
		$configured = $this->service->isConfigured();
		return new JSONResponse([
			'configured'     => $configured,
			'setup_complete' => $configured,
			'email'          => $configured ? $this->service->getEmail() : null,
		]);
	}

	/**
	 * @NoAdminRequired
	 */
	public function setConfig(string $email = '', string $password = ''): JSONResponse {
		$email = trim($email);
		// Loose RFC 5321 email check — Scalable enforces the real validation.
		if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email)) {
			return new JSONResponse(
				['status' => 'bad_request', 'detail' => 'email must look like a@b.c'],
				Http::STATUS_BAD_REQUEST
			);
		}
		if (strlen($password) < 8) {
			return new JSONResponse(
				['status' => 'bad_request', 'detail' => 'password must be at least 8 characters'],
				Http::STATUS_BAD_REQUEST
			);
		}
		$this->service->setCredentials($email, $password);
		return new JSONResponse(['status' => 'ok']);
	}

	/**
	 * @NoAdminRequired
	 */
	public function update($full = null): JSONResponse {
		// Wrap the whole thing so an unexpected throw NEVER becomes a 500 HTML
		// page (which the JS could only show as "non-JSON HTML" soup). The
		// browser always gets parseable JSON it can render in the toast.
		try {
			$forceFull = $full === true || $full === 'true' || $full === 1 || $full === '1';
			$result = $this->service->runFetch($forceFull);

			static $map = [
				ScalableService::EXIT_OK            => [Http::STATUS_OK,                      'ok'],
				ScalableService::EXIT_MFA_REQUIRED  => [Http::STATUS_UNAUTHORIZED,            'mfa_required'],
				ScalableService::EXIT_MFA_INVALID   => [Http::STATUS_UNAUTHORIZED,            'mfa_invalid'],
				ScalableService::EXIT_AUTH_FAILED   => [Http::STATUS_UNAUTHORIZED,            'auth_failed'],
				ScalableService::EXIT_API_ERROR     => [Http::STATUS_BAD_GATEWAY,             'api_error'],
				ScalableService::EXIT_TIMEOUT       => [Http::STATUS_GATEWAY_TIMEOUT,         'timeout'],
				ScalableService::EXIT_CONFIG_ERROR  => [Http::STATUS_INTERNAL_SERVER_ERROR,   'config_error'],
			];
			$exit = $result['exitCode'];
			[$httpStatus, $jsonStatus] = $map[$exit] ?? [Http::STATUS_INTERNAL_SERVER_ERROR, 'error'];

			$payload = ['status' => $jsonStatus, 'exitCode' => $exit];
			if ($httpStatus === Http::STATUS_OK) {
				$payload['output'] = substr((string) $result['stdout'], -2000);
			} else {
				$stderr = trim((string) $result['stderr']);
				$lastLine = $stderr === '' ? '' : substr(strrchr("\n" . $stderr, "\n"), 1, 240);
				$payload['detail'] = $lastLine !== ''
					? $lastLine
					: ('update failed (' . $jsonStatus . ', exit ' . $exit . ') — see fetch.log');
			}
			return new JSONResponse($payload, $httpStatus);
		} catch (\Throwable $e) {
			\OC::$server->getLogger()->logException($e, [
				'app' => 'scalable_capital',
				'message' => 'api#update threw',
			]);
			return new JSONResponse([
				'status' => 'error',
				'detail' => 'internal error: ' . $e->getMessage(),
			], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
	}

	/**
	 * @NoAdminRequired
	 */
	public function reset($wipe_data_only = null): JSONResponse {
		$dataOnly = $wipe_data_only === true || $wipe_data_only === 'true' || $wipe_data_only === 1 || $wipe_data_only === '1';
		if ($dataOnly) {
			$this->service->wipeUserData();
		} else {
			$this->service->reset();
		}
		return new JSONResponse(['status' => 'ok']);
	}

	// =====================================================================
	// Per-page CSV exports — verbatim port of
	// Scalable-Capital-Dashboard/app/server.py::_export_*_csv() helpers.
	// Same pattern as TR's exportCsv: one route, switch on `kind`, each
	// branch builds a focused CSV from transactions.json or wealth.json.
	// =====================================================================

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function exportCsv(string $kind): Http\Response {
		switch ($kind) {
			case 'orders':    return $this->_csvFromTx('orders.csv',    'orders');
			case 'ledger':    return $this->_csvFromTx('ledger.csv',    'ledger');
			case 'dividends': return $this->_csvFromTx('dividends.csv', 'dividends');
			case 'holdings':  return $this->_csvFromInventory();
			case 'wealth':    return $this->_csvFromWealth();
			default:
				return new JSONResponse(['error' => 'unknown export kind'], Http::STATUS_BAD_REQUEST);
		}
	}

	private function _csvRow(array $row): string {
		$cells = [];
		foreach ($row as $cell) {
			$cell = (string) $cell;
			if (strpbrk($cell, ",\"\n\r") !== false) {
				$cell = '"' . str_replace('"', '""', $cell) . '"';
			}
			$cells[] = $cell;
		}
		return implode(',', $cells) . "\n";
	}

	private function _csvFromTx(string $filename, string $mode): Http\Response {
		// Scalable transaction events seen in the wild (from sc-api docs/events.md):
		//   TRADE / SAVINGS_PLAN_EXECUTED → orders
		//   DIVIDEND / COUPON             → dividends
		//   DEPOSIT / WITHDRAWAL / TRANSFER_IN / TRANSFER_OUT / PAYMENT / FEE → ledger
		$tx = $this->service->readJson('transactions.json') ?? [];
		// `transactions.json` from sc-api: {"items": [...], "page_info": {...}}
		$items = is_array($tx['items'] ?? null) ? $tx['items'] : (array) $tx;

		if ($mode === 'orders') {
			$out = $this->_csvRow(['date', 'side', 'event', 'isin', 'security', 'quantity', 'amount_eur', 'status']);
		} elseif ($mode === 'ledger') {
			$out = $this->_csvRow(['date', 'event', 'category', 'description', 'isin', 'amount_eur', 'status']);
		} else {
			$out = $this->_csvRow(['date', 'security', 'isin', 'amount_eur', 'currency', 'status']);
		}

		$orderEvents = ['TRADE', 'SAVINGS_PLAN_EXECUTED', 'BUY', 'SELL'];
		$divEvents = ['DIVIDEND', 'COUPON', 'INTEREST'];

		foreach ($items as $t) {
			if (!is_array($t)) continue;
			$date = (string) ($t['executedAt'] ?? $t['createdAt'] ?? $t['date'] ?? '');
			$event = (string) ($t['type'] ?? $t['eventType'] ?? '');
			$amount = (string) ($t['amount'] ?? $t['cashAmount']['value'] ?? '');
			$isin = (string) ($t['security']['isin'] ?? $t['isin'] ?? '');
			$name = (string) ($t['security']['name'] ?? $t['description'] ?? '');
			$qty = (string) ($t['quantity'] ?? '');
			$status = (string) ($t['status'] ?? 'EXECUTED');

			if ($mode === 'orders') {
				if (!in_array($event, $orderEvents, true)) continue;
				$side = ((float) $amount) < 0 ? 'Buy' : 'Sell';
				$out .= $this->_csvRow([$date, $side, $event, $isin, $name, $qty, $amount, $status]);
			} elseif ($mode === 'ledger') {
				$cat = 'other';
				if (in_array($event, $orderEvents, true))         $cat = 'trade';
				elseif (in_array($event, $divEvents, true))       $cat = 'dividend';
				elseif (in_array($event, ['DEPOSIT', 'TRANSFER_IN'], true))   $cat = 'deposit';
				elseif (in_array($event, ['WITHDRAWAL', 'TRANSFER_OUT'], true)) $cat = 'withdrawal';
				elseif ($event === 'PAYMENT')                     $cat = 'payment';
				elseif ($event === 'FEE')                         $cat = 'fee';
				$out .= $this->_csvRow([$date, $event, $cat, $name, $isin, $amount, $status]);
			} else {
				if (!in_array($event, $divEvents, true)) continue;
				$out .= $this->_csvRow([$date, $name, $isin, $amount, 'EUR', $status]);
			}
		}

		return $this->_sendCsv($filename, $out);
	}

	private function _csvFromInventory(): Http\Response {
		$inv = $this->service->readJson('inventory.json') ?? [];
		$positions = is_array($inv['positions'] ?? null) ? $inv['positions'] : (array) $inv;

		$out = $this->_csvRow(['name', 'isin', 'type', 'quantity', 'avg_cost', 'current_price', 'value_eur', 'pnl_eur']);
		foreach ($positions as $p) {
			if (!is_array($p)) continue;
			$out .= $this->_csvRow([
				$p['name']          ?? $p['security']['name'] ?? '',
				$p['isin']          ?? $p['security']['isin'] ?? '',
				$p['type']          ?? $p['instrumentType']   ?? '',
				$p['quantity']      ?? $p['units']            ?? '',
				$p['avgCost']       ?? $p['averagePrice']     ?? '',
				$p['currentPrice']  ?? '',
				$p['marketValue']   ?? $p['valueEur']         ?? '',
				$p['unrealizedPnl'] ?? $p['plEur']            ?? '',
			]);
		}
		return $this->_sendCsv('holdings.csv', $out);
	}

	private function _csvFromWealth(): Http\Response {
		$detail = $this->service->readJson('wealth_detail.json') ?? [];
		$wealth = is_array($detail) ? $detail : [];

		$out = $this->_csvRow(['portfolio_id', 'name', 'status', 'value_eur', 'twr_pct', 'capital_invested_eur']);
		// wealth_detail is typically a list of portfolios with .latestAllocation etc.
		$portfolios = is_array($wealth[0] ?? null) ? $wealth : [$wealth];
		foreach ($portfolios as $p) {
			if (!is_array($p)) continue;
			$twr = $p['timeWeightedReturn']['percentage'] ?? $p['twr']['percentage'] ?? '';
			$out .= $this->_csvRow([
				$p['portfolioId'] ?? $p['id'] ?? '',
				$p['name'] ?? '',
				$p['status'] ?? '',
				$p['currentValue']['value'] ?? $p['value']['value'] ?? '',
				$twr,
				$p['totalInvested']['value'] ?? '',
			]);
		}
		return $this->_sendCsv('wealth.csv', $out);
	}

	private function _sendCsv(string $filename, string $body): Http\Response {
		$response = new DataDisplayResponse(
			$body,
			Http::STATUS_OK,
			['Content-Type' => 'text/csv; charset=utf-8']
		);
		$response->addHeader('Content-Disposition', 'attachment; filename="' . $filename . '"');
		return $response;
	}
}
