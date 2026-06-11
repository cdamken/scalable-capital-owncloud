<?php
/**
 * Renders the HTML pages.
 *
 * No data is inlined — pages fetch JSON via the api#data route, which is what
 * isolates one user from another at request time.
 *
 * Port from Scalable-Capital-Dashboard. The 9 mechanical patches from
 * OWNCLOUD-PATCHES.md are applied here: every template wraps the upstream
 * HTML body in #sc-app with data-route-* attrs, inline <script> moved to
 * js/<name>.js (CSP), CSS scoped to #sc-app in css/dashboard.css.
 */

namespace OCA\ScalableCapital\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;

class PageController extends Controller {

	private $urlGenerator;
	private $userSession;

	public function __construct(
		string $appName,
		IRequest $request,
		IURLGenerator $urlGenerator,
		IUserSession $userSession
	) {
		parent::__construct($appName, $request);
		$this->urlGenerator = $urlGenerator;
		$this->userSession = $userSession;
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function index() {
		return $this->renderTemplate('main');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function settings() {
		return $this->renderTemplate('settings');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function orders() {
		return $this->renderTemplate('orders');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function ledger() {
		return $this->renderTemplate('ledger');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function dividends() {
		return $this->renderTemplate('dividends');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function analytics() {
		return $this->renderTemplate('analytics');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function wealth() {
		return $this->renderTemplate('wealth');
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 */
	public function glossary() {
		return $this->renderTemplate('glossary');
	}

	private function renderTemplate(string $template) {
		if (!$this->userSession->isLoggedIn()) {
			$here = $this->urlGenerator->linkToRoute('scalable_capital.page.index');
			$login = $this->urlGenerator->linkToRoute('core.login.showLoginForm')
			       . '?redirect_url=' . rawurlencode($here);
			return new RedirectResponse($login);
		}
		\OCP\Util::addStyle($this->appName, 'dashboard');

		// All Dashboard charts are pure SVG (no Chart.js), but we keep the
		// vendored copy available in case future pages need it. The TR port
		// loads it for analytics/dividends; SC uses SVG so nothing is loaded
		// for those pages here. If a future page imports Chart, add it to the
		// list below — Util::addScript auto-appends '.js', no suffix.
		// if (in_array($template, ['analytics', 'dividends', 'wealth'], true)) {
		//     \OCP\Util::addScript($this->appName, 'vendor/chart.umd.min');
		// }

		$scriptMap = [
			'main'      => 'dashboard',
			'settings'  => 'settings',
			'orders'    => 'orders',
			'ledger'    => 'ledger',
			'dividends' => 'dividends',
			'analytics' => 'analytics',
			'wealth'    => 'wealth',
			'glossary'  => 'glossary',
		];

		// _shared.js holds fmtMoney / fmtPct / fmtQty / fmtDate / on() /
		// getJSON / postJSON / setStaleness — common helpers used by every
		// page script. Loaded before update_flow.js and the per-page script.
		\OCP\Util::addScript($this->appName, '_shared');
		// Shared Update Now / staleness chip flow — loaded BEFORE the per-page
		// script so secondary pages get the button wired without each page
		// duplicating the logic. Main (dashboard.js) opts out via
		// data-update-flow-owner="page".
		\OCP\Util::addScript($this->appName, 'update_flow');
		\OCP\Util::addScript($this->appName, $scriptMap[$template] ?? 'dashboard');

		$params = [
			'routes' => [
				'index'     => $this->urlGenerator->linkToRoute('scalable_capital.page.index'),
				'settings'  => $this->urlGenerator->linkToRoute('scalable_capital.page.settings'),
				'orders'    => $this->urlGenerator->linkToRoute('scalable_capital.page.orders'),
				'ledger'    => $this->urlGenerator->linkToRoute('scalable_capital.page.ledger'),
				'dividends' => $this->urlGenerator->linkToRoute('scalable_capital.page.dividends'),
				'analytics' => $this->urlGenerator->linkToRoute('scalable_capital.page.analytics'),
				'wealth'    => $this->urlGenerator->linkToRoute('scalable_capital.page.wealth'),
				'glossary'  => $this->urlGenerator->linkToRoute('scalable_capital.page.glossary'),
				'data'      => $this->urlGenerator->linkToRoute('scalable_capital.api.data', ['type' => '__TYPE__']),
				'config'    => $this->urlGenerator->linkToRoute('scalable_capital.api.getConfig'),
				'setConfig' => $this->urlGenerator->linkToRoute('scalable_capital.api.setConfig'),
				'update'    => $this->urlGenerator->linkToRoute('scalable_capital.api.update'),
				'reset'     => $this->urlGenerator->linkToRoute('scalable_capital.api.reset'),
			],
		];

		$response = new TemplateResponse($this->appName, $template, $params);
		$csp = new ContentSecurityPolicy();
		// Verbatim upstream HTML/JS has many inline `style="..."` attributes —
		// CSP relaxed to allow them. Inline <script> remains blocked; inline
		// event handlers were re-wired to addEventListener via on() helper.
		$csp->allowInlineStyle(true);
		$response->setContentSecurityPolicy($csp);
		return $response;
	}
}
