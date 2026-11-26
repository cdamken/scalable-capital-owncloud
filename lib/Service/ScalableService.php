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
			'crypto_positions.json',
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

	/**
	 * Save credentials, and on an ACCOUNT switch wipe the previous account's
	 * session + data. Returns ['status' => 'ok'] or ['status' => 'busy'] when an
	 * update is in flight (the controller maps busy to HTTP 409).
	 */
	public function setCredentials(string $email, string $password): array {
		// Take the SAME lock runFetch uses: a credential change must not race an
		// in-flight fetch. Without this, a fetch still running with the OLD email
		// would rewrite cookies/meta/*.json right after we wiped them, leaving the
		// config on the new account but the disk on the old one — defect 8 again.
		$lock = $this->acquireUpdateLock();
		if ($lock === null) {
			return ['status' => 'busy'];
		}
		if ($lock === false) {
			$this->logError('update lock unavailable; saving credentials without concurrency guard');
		}
		try {
			$prevEmail = (string) $this->config->getUserValue($this->userId(), self::APPID, 'email', '');

			$this->config->setUserValue($this->userId(), self::APPID, 'email', $email);
			$this->config->setUserValue(
				$this->userId(), self::APPID, 'password_enc',
				$this->crypto->encrypt($password)
			);

			// Only an ACCOUNT switch (different email) invalidates the stored
			// session: the cookies + cached *.json belong to the previous account.
			// A same-email password change leaves the session alone on purpose — a
			// live session needs no re-login, and a dead one makes the wrapper
			// re-login with the new password on its own; wiping it would fire a push
			// the user didn't need (the very thing d08d36b set out to avoid).
			if ($prevEmail !== '' && strcasecmp($prevEmail, $email) !== 0) {
				$dir = $this->userDir();
				$targets = array_merge(
					[$dir . '/cookies.txt', $dir . '/meta.json'],
					glob($dir . '/cookies.txt.bak.*') ?: [],   // old session backups
					glob($dir . '/*.json') ?: []               // previous account's data
				);
				foreach ($targets as $f) {
					@unlink($f);
					if (file_exists($f)) {
						// Unlink failed (permissions): the stale file would keep
						// serving the old account. Surface it instead of failing silently.
						$this->logError('setCredentials: could not remove stale ' . basename($f) . ' on account switch');
					}
				}
			}
			return ['status' => 'ok'];
		} finally {
			$this->releaseUpdateLock($lock);
		}
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
	public function reset(): array {
		// Same lock as runFetch/setCredentials: a logout racing an in-flight
		// fetch would rrmdir files the wrapper is still writing. Returns 'busy'.
		$lock = $this->acquireUpdateLock();
		if ($lock === null) {
			return ['status' => 'busy'];
		}
		if ($lock === false) {
			$this->logError('update lock unavailable; resetting without concurrency guard');
		}
		try {
			$this->config->deleteUserValue($this->userId(), self::APPID, 'email');
			$this->config->deleteUserValue($this->userId(), self::APPID, 'password_enc');
			// Keep the data dir AND update.lock (we hold it). On NFS, deleting an
			// open file turns it into .nfsXXXX and the dir rmdir fails ("Directory
			// not empty"); and dropping the lock file mid-fetch would let a
			// concurrent update create a NEW update.lock (different inode) that no
			// longer excludes the one still running — breaking the SC 13 guarantee.
			// Everything else goes, benchmark_cache included.
			$this->clearUserDirExceptLock();
			return ['status' => 'ok'];
		} finally {
			$this->releaseUpdateLock($lock);
		}
	}

	public function wipeUserData(): array {
		// "Clear data" button (keep credentials). Same race as setCredentials — a
		// fetch in flight would rewrite the *.json right after we delete them —
		// so guard it with the same lock. Returns 'busy' if an update is running.
		$lock = $this->acquireUpdateLock();
		if ($lock === null) {
			return ['status' => 'busy'];
		}
		if ($lock === false) {
			$this->logError('update lock unavailable; clearing data without concurrency guard');
		}
		try {
			$dir = $this->userDir();
			foreach (glob($dir . '/*.json') ?: [] as $f) {
				@unlink($f);
			}
			return ['status' => 'ok'];
		} finally {
			$this->releaseUpdateLock($lock);
		}
	}

	/** Remove everything under userDir EXCEPT the directory itself and the
	 *  update.lock file we are holding (see reset() for the NFS/SC-13 reasons). */
	private function clearUserDirExceptLock(): void {
		$dir = $this->userDir();
		$items = scandir($dir);
		if ($items === false) {
			return;
		}
		foreach ($items as $item) {
			if ($item === '.' || $item === '..' || $item === 'update.lock') {
				continue;
			}
			$path = $dir . '/' . $item;
			if (is_dir($path) && !is_link($path)) {
				$this->rrmdir($path);
			} else {
				@unlink($path);
			}
		}
		// Logout must not leave a usable session on disk. If cookies.txt
		// survived the wipe (e.g. a permissions quirk), flag it loudly — a
		// silent survivor is a live Scalable session nobody knows is still there.
		if (file_exists($dir . '/cookies.txt')) {
			$this->logError('reset: cookies.txt survived the wipe — a Scalable session may still be live on disk');
		}
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

		// Per-user update lock. Two concurrent "Update Now" for the same user
		// would spawn two wrappers writing the same data dir, racing each
		// other's *.json (and both possibly firing a push). setCredentials takes
		// the SAME lock, so a credential change can't race an in-flight fetch.
		$lock = $this->acquireUpdateLock();
		if ($lock === null) {
			return [
				'exitCode' => self::EXIT_BUSY,
				'stdout'   => '',
				'stderr'   => 'an update is already running for this account',
			];
		}
		if ($lock === false) {
			$this->logError('update lock unavailable; running fetch without concurrency guard');
		}
		try {
			// 180 s ceiling — push approval polling alone takes up to 120s.
			// Mirrors TR's 240s but tighter since SC has no docs-download path.
			return $this->runProcess($cmd, $env, 180);
		} finally {
			$this->releaseUpdateLock($lock);
		}
	}

	/**
	 * Acquire the per-user update lock (exclusive, non-blocking). flock is
	 * advisory per open handle, so it auto-releases if the PHP process dies.
	 * Returns: a resource holding the lock on success; null if another holder
	 * has it (caller reports busy); false if the lock file can't be opened at
	 * all (caller should degrade WITHOUT the guard and logError). Shared by
	 * runFetch and setCredentials so their locking can never diverge.
	 *
	 * @return resource|null|false
	 */
	private function acquireUpdateLock() {
		$lock = @fopen($this->userDir() . '/update.lock', 'c');
		if ($lock === false) {
			return false;
		}
		if (!flock($lock, LOCK_EX | LOCK_NB)) {
			fclose($lock);
			return null;
		}
		return $lock;
	}

	/** Release a lock from acquireUpdateLock(). No-op for null/false. */
	private function releaseUpdateLock($lock): void {
		if (is_resource($lock)) {
			flock($lock, LOCK_UN);
			fclose($lock);
		}
	}

	private function resolvePython(): string {
		// 1) Explicit override (operator can set in config.php).
		$override = (string) $this->config->getSystemValue('scalable_capital.python_bin', '');
		if ($override !== '' && is_file($override)) {
			return $override;
		}
		// 2) Self-contained app-folder venv (python/.venv), built by
		//    python/bootstrap.sh. realpath() the bin DIR, not the python
		//    entry: that entry is a symlink to the base interpreter, and
		//    resolving it would drop the venv's site-packages.
		$venvBin = realpath(__DIR__ . '/../../python/.venv/bin');
		if ($venvBin !== false && is_executable($venvBin . '/python')) {
			return $venvBin . '/python';
		}
		// 3) System python3.
		return 'python3';
	}
}
