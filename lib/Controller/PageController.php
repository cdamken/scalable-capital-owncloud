<?php
/**
 * Renders the portfolio HTML page.
 *
 * No data is inlined — the page fetches JSON via the api#data route, which
 * is what isolates one user from another at request time.
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

	private function renderTemplate(string $template) {
		if (!$this->userSession->isLoggedIn()) {
			$here = $this->urlGenerator->linkToRoute('scalable_capital.page.index');
			$login = $this->urlGenerator->linkToRoute('core.login.showLoginForm')
			       . '?redirect_url=' . rawurlencode($here);
			return new RedirectResponse($login);
		}
		\OCP\Util::addStyle($this->appName, 'dashboard');
		\OCP\Util::addScript($this->appName, 'dashboard');

		$params = [
			'routes' => [
				'index'   => $this->urlGenerator->linkToRoute('scalable_capital.page.index'),
				'data'    => $this->urlGenerator->linkToRoute('scalable_capital.api.data', ['type' => '__TYPE__']),
				'config'  => $this->urlGenerator->linkToRoute('scalable_capital.api.getConfig'),
				'setConfig' => $this->urlGenerator->linkToRoute('scalable_capital.api.setConfig'),
				'update'  => $this->urlGenerator->linkToRoute('scalable_capital.api.update'),
				'reset'   => $this->urlGenerator->linkToRoute('scalable_capital.api.reset'),
			],
		];

		$response = new TemplateResponse($this->appName, $template, $params);
		$csp = new ContentSecurityPolicy();
		// Verbatim upstream HTML has many inline `style="..."` attributes.
		// Inline <script> remains blocked; inline event handlers were
		// re-wired to addEventListener via the null-safe `on()` helper.
		$csp->allowInlineStyle(true);
		$response->setContentSecurityPolicy($csp);
		return $response;
	}
}
