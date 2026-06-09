<?php
/**
 * ScalableService — per-user state + subprocess wrapper around sc-api.
 *
 * Identity binding (security boundary): userId comes from `IUserSession`,
 * NEVER from request input. `basename()` guard on every filesystem path.
 *
 * Storage:
 *   oc_preferences[<uid>][scalable_capital][email]         — Scalable login email
 *                                          [...]           — (no password stored; cookies via Chrome import)
 *   {datadir}/<uid>/scalable_capital/cookies.txt           — MozillaCookieJar from pycookiecheat (mode 0600)
 *   {datadir}/<uid>/scalable_capital/inventory.json …      — fetched data
 *   {datadir}/<uid>/scalable_capital/session.json          — sc-api profile meta
 *   {datadir}/<uid>/scalable_capital/fetch.log
 *
 * IMPORTANT cookies caveat (Phase 0): pycookiecheat reads Chrome's cookies
 * DB on the SERVER. In a multi-user ownCloud, that doesn't work — each user
 * has their own Chrome on their own machine. The plan for Phase 1: have the
 * user import cookies LOCALLY on their machine via the standalone sc-api
 * CLI, then UPLOAD the resulting cookies.txt to ownCloud (via a small
 * "Upload cookies" page). Documented in BACKLOG. For now this scaffold
 * assumes the cookies.txt is already in place.
 *
 * Shared DI plumbing (constructor, userId, userDir, runProcess, EXIT_*)
 * lives in BaseOwnCloudService — see that file for the security boundary
 * + subprocess gotchas. This class only carries Scalable-specific logic.
 */

namespace OCA\ScalableCapital\Service;

class ScalableService extends BaseOwnCloudService {

	const APPID = 'scalable_capital';

	protected function appDirName(): string {
		return self::APPID;
	}

	// ----- per-user paths -------------------------------------------------
	private function dataPath(string $file): string {
		// basename() guard — even if a future contributor passes user-supplied
		// input, this prevents "../etc/passwd" style traversal.
		return $this->userDir() . '/' . basename($file);
	}

	// ----- config (email only — no password) ------------------------------
	public function getEmail(): string {
		return $this->config->getUserValue($this->userId(), self::APPID, 'email', '');
	}

	public function setEmail(string $email): void {
		$this->config->setUserValue($this->userId(), self::APPID, 'email', $email);
	}

	public function isConfigured(): bool {
		return $this->getEmail() !== '' && file_exists($this->dataPath('cookies.txt'));
	}

	// ----- data ----------------------------------------------------------
	public function readJson(string $file) {
		$path = $this->dataPath($file);
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

	public function wipeUserData(): void {
		$dir = $this->userDir();
		foreach (glob($dir . '/*.json') ?: [] as $f) {
			@unlink($f);
		}
		// Keep cookies.txt — wiping it would force re-import; users can
		// explicitly remove via a "Forget cookies" button (TBD in Phase 1).
	}

	// ----- subprocess -----------------------------------------------------
	/**
	 * Returns ['exitCode' => int, 'log' => str]. The `log` key carries the
	 * last 4 KB of stderr — historic shape consumed by ApiController. Once
	 * SC grows a real MFA flow this should return the same triple
	 * (exitCode/stdout/stderr) that GBM and TR return so it can map every
	 * canonical exit code without losing detail. Tracked in BACKLOG.
	 */
	public function runFetch(): array {
		$wrapper = realpath(__DIR__ . '/../../python/fetch_wrapper.py');
		if ($wrapper === false || !is_file($wrapper)) {
			return ['exitCode' => self::EXIT_CONFIG_ERROR, 'log' => 'config_error: fetch_wrapper.py missing'];
		}

		$python = $this->resolvePython();
		$cmd = [
			$python,
			$wrapper,
			'--email', $this->getEmail(),
			'--data-dir', $this->userDir(),
			'--cookies', $this->dataPath('cookies.txt'),
		];

		$env = [
			'PATH' => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
			'HOME' => sys_get_temp_dir(),
			'SC_API_PROFILE_DIR' => $this->userDir(),
			'LANG' => 'en_US.UTF-8',
		];

		// 180 s ceiling matches GBM. Scalable's GraphQL queries are sub-second
		// so a long fetch implies a network problem; treat it as EXIT_TIMEOUT.
		$result = $this->runProcess($cmd, $env, 180);

		return [
			'exitCode' => $result['exitCode'],
			'log'      => substr((string) $result['stderr'], -4000),
		];
	}

	private function resolvePython(): string {
		// 1) Explicit override (operator can set in config.php).
		$override = $this->config->getSystemValue('scalable_capital.python', '');
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
