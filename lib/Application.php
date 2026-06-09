<?php
/**
 * Application class — registers the navigation entry.
 *
 * ScalableService is NOT registered as a custom binding here: the ownCloud 10
 * DI container auto-wires it from its IUserSession + IConfig + ICrypto
 * constructor. To keep per-user isolation, ScalableService resolves the
 * userId lazily from IUserSession (see ScalableService::userId()).
 *
 * Mirrors trade_republic and gbm apps.
 */

namespace OCA\ScalableCapital;

use OCP\AppFramework\App;
use OCP\INavigationManager;
use OCP\IURLGenerator;

class Application extends App {

	const APPID = 'scalable_capital';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APPID, $urlParams);

		$container = $this->getContainer();

		$container->query(INavigationManager::class)->add(function () use ($container) {
			$url = $container->query(IURLGenerator::class);
			return [
				'id'    => self::APPID,
				'order' => 80,
				'href'  => $url->linkToRoute('scalable_capital.page.index'),
				'icon'  => $url->imagePath(self::APPID, 'app.svg'),
				'name'  => 'Scalable Capital',
			];
		});
	}
}
