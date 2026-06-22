<?php
/**
 * occ scalable_capital:ingest <user>
 *
 * Normalise the user's Scalable Capital fetch output (inventory/cash/
 * transactions/wealth/broker_overview JSON) into the sc_* DB tables.
 * Read-only against the broker; idempotent (events upserted by id).
 */

namespace OCA\ScalableCapital\Command;

use OCA\ScalableCapital\Service\IngestService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class Ingest extends Command {
	/** @var IngestService */
	private $ingest;

	public function __construct(IngestService $ingest) {
		parent::__construct();
		$this->ingest = $ingest;
	}

	protected function configure() {
		$this->setName('scalable_capital:ingest')
			->setDescription('Normalise a user\'s Scalable Capital JSON into the sc_* DB tables')
			->addArgument('user', InputArgument::REQUIRED, 'ownCloud user id');
	}

	protected function execute(InputInterface $input, OutputInterface $output) {
		$uid = (string) $input->getArgument('user');
		try {
			$c = $this->ingest->ingestForUser($uid);
		} catch (\Throwable $e) {
			$output->writeln('<error>' . $uid . ': ' . $e->getMessage() . '</error>');
			return 1;
		}
		$output->writeln(sprintf(
			'<info>%s</info>  accounts=%d holdings=%d securities=%d orders=%d tx=%d dividends=%d snapshot=%d',
			$uid, $c['accounts'], $c['holdings'], $c['securities'],
			$c['orders'], $c['transactions'], $c['dividends'], $c['snapshot']
		));
		return 0;
	}
}
