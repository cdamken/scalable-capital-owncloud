<?php
/** HoldingMapper — layer 1 state. Scoped by user_id. */

namespace OCA\ScalableCapital\Db;

use OCP\AppFramework\Db\Mapper;
use OCP\IDBConnection;

class HoldingMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'sc_holdings', Holding::class);
	}

	/** @return Holding[] */
	public function findByUser(string $userId): array {
		$sql = 'SELECT * FROM `*PREFIX*sc_holdings` WHERE `user_id` = ?';
		return $this->findEntities($sql, [$userId]);
	}

	/** @return Holding[] */
	public function findByAccount(string $userId, int $accountId): array {
		$sql = 'SELECT * FROM `*PREFIX*sc_holdings` WHERE `user_id` = ? AND `account_id` = ?';
		return $this->findEntities($sql, [$userId, $accountId]);
	}

	/** State layer is replaced on each ingest: wipe this user's rows first. */
	public function deleteByUser(string $userId): void {
		$this->execute('DELETE FROM `*PREFIX*sc_holdings` WHERE `user_id` = ?', [$userId]);
	}
}
