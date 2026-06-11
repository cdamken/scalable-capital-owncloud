<?php
/**
 * Per-user bridge to the sc-api Python library.
 *
 * Every public method here operates on a single ownCloud user. The userId is
 * resolved lazily from IUserSession (see BaseOwnCloudService::userId()),
 * which makes leaking another user's data structurally impossible: every
 * path goes through userId() at request time, and there is no setter for it.
 *
 * Storage layout ({datadirectory} is the ownCloud root data dir):
 *
 *   {datadirectory}/{uid}/scalable_capital/
 *     ├── cookies.txt                ← MozillaCookieJar, 0600 (sc-api session)
 *     ├── meta.json                  ← sc-api profile meta (person_id, portfolio_ids)
 *     ├── inventory.json             ← Broker positions
 *     ├── cash.json                  ← Broker cash + buying power
 *     ├── transactions.json          ← paginated transaction history
 *     ├── wealth.json                ← Wealth portfolios overview
 *     ├── wealth_detail.json         ← Wealth detail (TWR, capital invested, ETF allocations)
 *     ├── watchlist.json
 *     ├── crypto.json, interest.json, pending_orders.json, broker_overview.json
 *     ├── last_update.json           ← {"timestamp": "YYYY-MM-DDTHH:MM:SSZ"}
 *     └── fetch.log                  ← stdout/stderr of last wrapper run
 *
 * Credentials live in oc_preferences (per-user). Password is encrypted with
 * ICrypto. Mirrors TrService's PIN-encrypted pattern.
 *
 * Shared DI plumbing (constructor, userId, userDir, runProcess, EXIT_*) lives
 * in BaseOwnCloudService — see that file for the security boundary +
 * subprocess gotchas. This class only carries Scalable-specific logic.
 */

namespace OCA\ScalableCapital\Service;

class ScalableService extends BaseOwnCloudService {

	const APPID = 'scalable_capital';

	protected function appDirName(): string {
		return self::APPID;
	}

	// ------------------------------------------------------------------
	// Paths (per-user, isolated)
	// ------------------------------------------------------------------
	public function dataPath(string $name): string {
		// Whitelist all data files written by python/fetch_wrapper.py.
		// basename() in BaseOwnCloudService::userDir() prevents traversal
		// even if a future contributor forgets to gate input.
		$allowed = [
			'inventory.json',
			'cash.json',
			'interest.json',
			'crypto.json',
			'pending_orders.json',
			'watchlist.json',
			'transactions.json',
			'savings.json',
			'savings_transactions.json',
			'wealth.json',
			'wealth_detail.json',
			'broker_overview.json',
			'last_update.json',
			'cookies.txt',
			'meta.json',
		];
		if (!in_array($name, $allowed, true)) {
			throw new \InvalidArgumentException("unknown data file: $name");
		}
		return $this->userDir() . '/' . $name;
	}

	public function readJson(string $name) {
		$path = $this->dataPath($name);
		if (!is_file($path)) {
			return null;
		}
		$raw = @file_get_contents($path);
		if ($raw === false) {
			return null;
		}
		$json = json_decode($raw, true);
		return $json === null ? null : $json;
	}

	// ------------------------------------------------------------------
	// Credentials (per-user, password encrypted via ICrypto)
	// ------------------------------------------------------------------
	public function getEmail(): string {
		return (string) $this->config->getUserValue($this->userId(), self::APPID, 'email', '');
	}

	public function isConfigured(): bool {
		$email = $this->getEmail();
		$pwd = (string) $this->config->getUserValue($this->userId(), self::APPID, 'password_enc', '');
		return $email !== '' && $pwd !== '';
	}

	public function setCredentials(string $email, string $password): void {
		$this->config->setUserValue($this->userId(), self::APPID, 'email', $email);
		$this->config->setUserValue(
			$this->userId(), self::APPID, 'password_enc',
			$this->crypto->encrypt($password)
		);
	}

	private function getDecryptedPassword(): string {
		$enc = (string) $this->config->getUserValue($this->userId(), self::APPID, 'password_enc', '');
		if ($enc === '') {
			return '';
		}
		try {
			return $this->crypto->decrypt($enc);
		} catch (\Exception $e) {
			return '';
		}
	}

	// ------------------------------------------------------------------
	// Reset (wipe everything for this user)
	// ------------------------------------------------------------------
	public function reset(): void {
		$this->config->deleteUserValue($this->userId(), self::APPID, 'email');
		$this->config->deleteUserValue($this->userId(), self::APPID, 'password_enc');
		$this->rrmdir($this->userDir());
	}

	public function wipeUserData(): void {
		// Wipe data only (keep credentials). Used by the "Clear data" button
		// in Settings — separate from "Logout" which calls reset().
		$dir = $this->userDir();
		foreach (glob($dir . '/*.json') ?: [] as $f) {
			@unlink($f);
		}
		@unlink($dir . '/last_update.json');
	}

	private function rrmdir(string $dir): void {
		if (!is_dir($dir)) {
			return;
		}
		$items = scandir($dir);
		if ($items === false) {
			return;
		}
		foreach ($items as $item) {
			if ($item === '.' || $item === '..') {
				continue;
			}
			$path = $dir . '/' . $item;
			if (is_dir($path) && !is_link($path)) {
				$this->rrmdir($path);
			} else {
				@unlink($path);
			}
		}
		@rmdir($dir);
	}

	// ------------------------------------------------------------------
	// Update: invoke the Python wrapper
	// ------------------------------------------------------------------
	/**
	 * Runs the bridge script and returns ['exitCode' => int, 'stdout' => str, 'stderr' => str].
	 *
	 * Auth model (no two-step MFA like TR — push approval happens INSIDE the
	 * wrapper while it polls Scalable's validate2faOnLogin GraphQL):
	 *
	 *   1. PHP spawns wrapper with SC_EMAIL + SC_PASSWORD env vars
	 *   2. Wrapper checks cookies.txt; if alive, fetches data and exits 0
	 *   3. If cookies dead, wrapper runs sc_api.auth.login_flow():
	 *        a. POSTs email+password to Auth0  (returns push session id)
	 *        b. Push hits the user's phone
	 *        c. Polls /auth/graphql every 2s for SUCCESS
	 *        d. If SUCCESS → fetches data, exits 0
	 *        e. If DENY/TIMEOUT → exits 11 (mfa_invalid)
	 *   4. PHP maps exit code to HTTP status; JS shows the right toast.
	 *
	 * $full forces a full transactions re-download (wrapper does incremental
	 * by default).
	 */
	public function runFetch(bool $full = false): array {
		if (!$this->isConfigured()) {
			return ['exitCode' => self::EXIT_CONFIG_ERROR, 'stdout' => '', 'stderr' => 'credentials not configured'];
		}

		$wrapper = realpath(__DIR__ . '/../../python/fetch_wrapper.py');
		if ($wrapper === false || !is_file($wrapper)) {
			return ['exitCode' => self::EXIT_CONFIG_ERROR, 'stdout' => '', 'stderr' => 'fetch_wrapper.py not found'];
		}

		$python = $this->resolvePython();
		$cmd = [
			$python,
			$wrapper,
			'--email',     $this->getEmail(),
			'--data-dir',  $this->userDir(),
		];
		if ($full) {
			$cmd[] = '--full';
		}

		// SC_PASSWORD env-injected — never appears on the argv (which is
		// visible in `ps`). Wrapper reads it via os.environ.
		$env = [
			'SC_EMAIL'    => $this->getEmail(),
			'SC_PASSWORD' => $this->getDecryptedPassword(),
			'PATH'        => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
			'HOME'        => sys_get_temp_dir(),
			'LANG'        => 'en_US.UTF-8',
		];

		// 180 s ceiling — push approval polling alone takes up to 120s.
		// Mirrors TR's 240s but tighter since SC has no docs-download path.
		return $this->runProcess($cmd, $env, 180);
	}

	private function resolvePython(): string {
		// 1) Explicit override (operator can set in config.php).
		$override = (string) $this->config->getSystemValue('scalable_capital.python_bin', '');
		if ($override !== '' && is_file($override)) {
			return $override;
		}
		// 2) Project-conventional venv (matches TR/GBM ownCloud apps).
		foreach (['/opt/sc-venv/bin/python', '/opt/sc-api-venv/bin/python'] as $cand) {
			if (is_file($cand)) {
				return $cand;
			}
		}
		// 3) System python3.
		return 'python3';
	}
}
