<?php
/**
 * IngestService (SC) — normalise the Scalable Capital fetch output into the
 * sc_* DB tables. Same role + idempotency as gbm/tr, SC-specific shapes:
 *
 *   BROKER
 *   - inventory.json: GraphQL-nested. Holdings live in
 *     ungroupedInventoryItems.items[] AND portfolioGroups.items[].items[].
 *     Each item: {isin, name, type (STOCK/ETF/…), inventory.position.filled
 *     (qty), quoteTick.midPrice (live price, EUR)}. NO cost basis in inventory
 *     → avg_cost left empty; unrealized P&L needs FIFO from transactions
 *     (transactions DO carry quantity+amount, unlike TR).
 *   - cash.json: buyingPower.cashBalance (EUR).
 *   - broker_overview.json: [{valuation, crypto_valuation}] → broker total.
 *   - transactions.json: {transactions:[{id, type, side, isin, quantity,
 *     amount, status, lastEventDateTime, securityTransactionType, …}]}.
 *       type=SECURITY_TRANSACTION + side BUY/SELL → order (price=amount/qty,
 *         status SETTLED→filled / CANCELLED→cancelled / PENDING→pending)
 *       type=CASH_TRANSACTION → transaction (cash flow)
 *       REINVESTMENT / dividend-ish → dividend
 *
 *   WEALTH (roboadvisor)
 *   - wealth.json: [{id, name, valuation, invested, …}] → one account per
 *     portfolio (account_key "wealth-<id>"), total_value = valuation.
 *
 * STATE (accounts/holdings) replaced each run; EVENTS upserted by external_id
 * (SC gives a real transaction id); SECURITIES find-or-create by ISIN; one
 * portfolio_snapshot per data date.
 */

namespace OCA\ScalableCapital\Service;

use OCA\ScalableCapital\Db\Account;
use OCA\ScalableCapital\Db\AccountMapper;
use OCA\ScalableCapital\Db\Dividend;
use OCA\ScalableCapital\Db\DividendMapper;
use OCA\ScalableCapital\Db\Holding;
use OCA\ScalableCapital\Db\HoldingMapper;
use OCA\ScalableCapital\Db\Order;
use OCA\ScalableCapital\Db\OrderMapper;
use OCA\ScalableCapital\Db\PortfolioSnapshot;
use OCA\ScalableCapital\Db\PortfolioSnapshotMapper;
use OCA\ScalableCapital\Db\Security;
use OCA\ScalableCapital\Db\SecurityMapper;
use OCA\ScalableCapital\Db\Transaction;
use OCA\ScalableCapital\Db\TransactionMapper;
use OCP\IConfig;

class IngestService {
	private const BROKER_KEY = 'broker';

	/** @var IConfig */ private $config;
	/** @var SecurityMapper */ private $securities;
	/** @var AccountMapper */ private $accounts;
	/** @var HoldingMapper */ private $holdings;
	/** @var OrderMapper */ private $orders;
	/** @var TransactionMapper */ private $transactions;
	/** @var DividendMapper */ private $dividends;
	/** @var PortfolioSnapshotMapper */ private $snapshots;

	/** isin => security row id, cached per run. */
	private $secCache = [];

	public function __construct(
		IConfig $config,
		SecurityMapper $securities,
		AccountMapper $accounts,
		HoldingMapper $holdings,
		OrderMapper $orders,
		TransactionMapper $transactions,
		DividendMapper $dividends,
		PortfolioSnapshotMapper $snapshots
	) {
		$this->config = $config;
		$this->securities = $securities;
		$this->accounts = $accounts;
		$this->holdings = $holdings;
		$this->orders = $orders;
		$this->transactions = $transactions;
		$this->dividends = $dividends;
		$this->snapshots = $snapshots;
	}

	public function dataDir(string $uid): string {
		$base = (string) $this->config->getSystemValue('datadirectory', '/var/www/owncloud/data');
		return rtrim($base, '/') . '/' . $uid . '/scalable_capital';
	}

	/** @return array<string,int> */
	public function ingestForUser(string $uid): array {
		$dir = $this->dataDir($uid);
		if (!is_dir($dir)) {
			throw new \RuntimeException("No scalable_capital data dir for '$uid': $dir");
		}
		$this->secCache = [];
		$counts = ['accounts' => 0, 'holdings' => 0, 'securities' => 0,
			'orders' => 0, 'transactions' => 0, 'dividends' => 0, 'snapshot' => 0];

		$asOf = $this->readAsOf($dir);

		// --- STATE: wipe per-user holdings + accounts, rebuild --------------
		$this->holdings->deleteByUser($uid);
		$this->accounts->deleteByUser($uid);

		// Broker account: cash from cash.json, total from broker_overview.
		$cash = $this->loadJson($dir, 'cash.json') ?? [];
		$cashBalance = $this->f(($cash['buyingPower']['cashBalance'] ?? null));

		$brokerOv = $this->firstOf($this->loadJson($dir, 'broker_overview.json'));
		$brokerVal = $this->f($brokerOv['valuation'] ?? null) + $this->f($brokerOv['crypto_valuation'] ?? null);

		$brokerAcc = new Account();
		$brokerAcc->setUserId($uid);
		$brokerAcc->setAccountKey(self::BROKER_KEY);
		$brokerAcc->setName($brokerOv['name'] ?? 'Broker');
		$brokerAcc->setType('broker');
		$brokerAcc->setCurrency('EUR');
		$brokerAcc->setCashAmount($this->num($cashBalance));
		$brokerAcc->setTotalValue($this->num($brokerVal + $cashBalance));
		$brokerAcc->setUpdatedAt($asOf);
		$brokerAccId = (int) $this->accounts->insert($brokerAcc)->getId();
		$counts['accounts']++;

		// Broker holdings from the nested inventory.
		foreach ($this->inventoryItems($dir) as $it) {
			$isin = (string) ($it['isin'] ?? '');
			if ($isin === '') {
				continue;
			}
			$qty = $this->f(($it['inventory']['position']['filled'] ?? null));
			if ($qty == 0.0) {
				continue;  // nothing held (pending-only / closed)
			}
			$price = $this->f(($it['quoteTick']['midPrice'] ?? null));
			$secId = $this->resolveSecurity($uid, $isin, (string) ($it['name'] ?? ''), (string) ($it['type'] ?? ''));
			$hold = new Holding();
			$hold->setUserId($uid);
			$hold->setAccountId($brokerAccId);
			$hold->setSecurityId($secId);
			$hold->setQuantity($this->num($qty));
			$hold->setLastPrice($this->num($price));
			$hold->setMarketValue($this->num($qty * $price));
			// avg_cost not exposed by SC inventory; FIFO (sc:lots) derives realised
			// P&L from transactions. Leave cost empty rather than guess.
			$hold->setAvgCost($this->num(0));
			$this->save($this->holdings, $hold);
			$counts['holdings']++;
		}

		// Wealth roboadvisor portfolios → one account each (valuation only).
		$wealthTotal = 0.0;
		foreach (($this->loadJson($dir, 'wealth.json') ?: []) as $wp) {
			$wid = (string) ($wp['id'] ?? '');
			if ($wid === '') {
				continue;
			}
			$val = $this->f($wp['valuation'] ?? null);
			$wealthTotal += $val;
			$wa = new Account();
			$wa->setUserId($uid);
			$wa->setAccountKey('wealth-' . substr($wid, 0, 48));
			$wa->setName((string) ($wp['name'] ?? 'Wealth'));
			$wa->setType('wealth');
			$wa->setCurrency('EUR');
			$wa->setCashAmount($this->num(0));
			$wa->setTotalValue($this->num($val));
			$wa->setUpdatedAt($asOf);
			$this->accounts->insert($wa);
			$counts['accounts']++;
		}
		$counts['securities'] = count($this->secCache);

		// --- EVENTS: transactions.json -------------------------------------
		$txData = $this->loadJson($dir, 'transactions.json') ?? [];
		foreach (($txData['transactions'] ?? []) as $t) {
			$ext = (string) ($t['id'] ?? '');
			if ($ext === '') {
				$ext = substr(md5(json_encode($t)), 0, 32);
			}
			$type = (string) ($t['type'] ?? '');
			$stt = strtoupper((string) ($t['securityTransactionType'] ?? ''));
			$side = strtoupper((string) ($t['side'] ?? ''));
			$isin = trim((string) ($t['isin'] ?? ''));
			$qty = $this->f($t['quantity'] ?? null);
			$amount = $this->f($t['amount'] ?? null);
			$date = (string) ($t['lastEventDateTime'] ?? $t['bookingDate'] ?? '');
			$secId = $isin !== '' ? $this->resolveSecurity($uid, $isin, (string) ($t['description'] ?? ''), '') : null;

			if ($type === 'SECURITY_TRANSACTION' && ($side === 'BUY' || $side === 'SELL')) {
				$entity = $this->orders->findByExternalId($uid, $ext) ?? $this->newOrder($uid, $ext);
				$entity->setAccountKey(self::BROKER_KEY);
				if ($secId !== null) {
					$entity->setSecurityId($secId);
				}
				$entity->setSide($side === 'SELL' ? 'sell' : 'buy');
				$entity->setQuantity($this->num($qty));
				$entity->setPrice($this->num($qty != 0.0 ? abs($amount) / $qty : 0));
				$entity->setFees($this->num(0));
				$entity->setCurrency((string) ($t['currency'] ?? 'EUR'));
				$entity->setExecutedAt($date);
				$entity->setStatus($this->orderStatus((string) ($t['status'] ?? '')));
				$this->save($this->orders, $entity);
				$counts['orders']++;
			} elseif ($stt === 'REINVESTMENT' || stripos((string) ($t['description'] ?? ''), 'dividend') !== false) {
				$entity = $this->dividends->findByExternalId($uid, $ext) ?? $this->newDividend($uid, $ext);
				if ($secId !== null) {
					$entity->setSecurityId($secId);
				}
				$entity->setGross($this->num($amount));
				$entity->setNet($this->num($amount));
				$entity->setTax($this->num(0));
				$entity->setCurrency((string) ($t['currency'] ?? 'EUR'));
				$entity->setPaidAt($date);
				$this->save($this->dividends, $entity);
				$counts['dividends']++;
			} else {
				$entity = $this->transactions->findByExternalId($uid, $ext) ?? $this->newTransaction($uid, $ext);
				$entity->setType($type);
				$entity->setRawType($stt !== '' ? $stt : $side);
				$entity->setAmount($this->num($amount));
				$entity->setCurrency((string) ($t['currency'] ?? 'EUR'));
				if ($secId !== null) {
					$entity->setSecurityId($secId);
				}
				$entity->setBookedAt($date);
				$this->save($this->transactions, $entity);
				$counts['transactions']++;
			}
		}

		// --- HISTORY: one snapshot for the data date -----------------------
		$totalValue = $brokerVal + $cashBalance + $wealthTotal;
		$snap = $this->snapshots->findByDate($uid, $asOf) ?? $this->newSnapshot($uid, $asOf);
		$snap->setTotalValue($this->num($totalValue));
		$snap->setTotalCost($this->num(0));   // SC exposes no portfolio-wide cost basis
		$snap->setCash($this->num($cashBalance));
		$snap->setCurrency('EUR');
		$snap->setSource('ingest');
		$this->save($this->snapshots, $snap);
		$counts['snapshot'] = 1;

		return $counts;
	}

	// --- helpers ---------------------------------------------------------

	/** Flatten the GraphQL-nested inventory into a list of holding items. */
	private function inventoryItems(string $dir): array {
		$inv = $this->loadJson($dir, 'inventory.json') ?? [];
		$out = [];
		foreach (($inv['ungroupedInventoryItems']['items'] ?? []) as $it) {
			$out[] = $it;
		}
		foreach (($inv['portfolioGroups']['items'] ?? []) as $g) {
			foreach (($g['items'] ?? []) as $it) {
				$out[] = $it;
			}
		}
		return $out;
	}

	private function orderStatus(string $s): string {
		$s = strtoupper($s);
		if ($s === 'CANCELLED') {
			return 'cancelled';
		}
		if ($s === 'PENDING') {
			return 'pending';
		}
		return 'filled';  // SETTLED + anything else we treat as done
	}

	/** First element if the payload is a list, else the payload (or []). */
	private function firstOf($data): array {
		if (is_array($data) && isset($data[0]) && is_array($data[0])) {
			return $data[0];
		}
		return is_array($data) ? $data : [];
	}

	private function resolveSecurity(string $uid, string $isin, string $name, string $assetClass): int {
		if (isset($this->secCache[$isin])) {
			return $this->secCache[$isin];
		}
		$sec = $this->securities->findByExtId($uid, $isin);
		if ($sec === null) {
			$sec = new Security();
			$sec->setUserId($uid);
			$sec->setExtId($isin);
			$sec->setName($name);
			$sec->setAssetClass($assetClass);
			$sec = $this->securities->insert($sec);
		} elseif ($name !== '' && (string) $sec->getName() === '') {
			$sec->setName($name);
			$this->securities->update($sec);
		}
		$id = (int) $sec->getId();
		$this->secCache[$isin] = $id;
		return $id;
	}

	private function newOrder(string $uid, string $ext): Order {
		$e = new Order(); $e->setUserId($uid); $e->setExternalId($ext); return $e;
	}

	private function newDividend(string $uid, string $ext): Dividend {
		$e = new Dividend(); $e->setUserId($uid); $e->setExternalId($ext); return $e;
	}

	private function newTransaction(string $uid, string $ext): Transaction {
		$e = new Transaction(); $e->setUserId($uid); $e->setExternalId($ext); return $e;
	}

	private function newSnapshot(string $uid, string $asOf): PortfolioSnapshot {
		$e = new PortfolioSnapshot(); $e->setUserId($uid); $e->setCapturedOn($asOf); return $e;
	}

	/** insert-or-update an entity that already carries its id (or not). */
	private function save($mapper, $entity): void {
		if ($entity->getId() === null) {
			$mapper->insert($entity);
		} else {
			$mapper->update($entity);
		}
	}

	/** Exact-decimal string for the text money columns (or '0'). */
	private function num($v): string {
		if ($v === null || $v === '') {
			return '0';
		}
		$s = rtrim(rtrim(sprintf('%.6f', (float) $v), '0'), '.');
		return $s === '' || $s === '-0' ? '0' : $s;
	}

	/** Parse a possibly-null numeric/string into float. */
	private function f($v): float {
		return $v === null || $v === '' ? 0.0 : (float) $v;
	}

	/** @return array|null */
	private function loadJson(string $dir, string $file) {
		$p = $dir . '/' . $file;
		if (!is_file($p)) {
			return null;
		}
		$d = json_decode((string) file_get_contents($p), true);
		return is_array($d) ? $d : null;
	}

	private function readAsOf(string $dir): string {
		$p = $dir . '/last_update.json';
		if (is_file($p)) {
			$d = json_decode((string) file_get_contents($p), true);
			$raw = is_array($d) ? (string) ($d['timestamp'] ?? $d['date'] ?? '') : '';
			if ($raw !== '') {
				return substr($raw, 0, 10);
			}
		}
		return date('Y-m-d');
	}
}
