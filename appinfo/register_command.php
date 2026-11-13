<?php
/** Register occ console commands with full DI (oC 10 pattern). */

$app = new \OCA\ScalableCapital\Application();
$container = $app->getContainer();

/** @var \Symfony\Component\Console\Application $application */
$application->addCommand($container->query(\OCA\ScalableCapital\Command\Ingest::class));
$application->addCommand($container->query(\OCA\ScalableCapital\Command\Analyze::class));
$application->addCommand($container->query(\OCA\ScalableCapital\Command\Lots::class));
