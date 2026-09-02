// Run a TypeORM DataSource's pending migrations under a Postgres session-level
// advisory lock, so multiple replicas booting at once serialise instead of
// racing the same DDL. The loser blocks on pg_advisory_lock until the winner
// commits, then runs (finds nothing pending) and moves on.
const runPendingMigrations = async (dataSource, lockKey, logger = console) => {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock($1)', [lockKey]);
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    if (applied.length) {
      logger.info
        ? logger.info({ migrations: applied.map((m) => m.name) }, 'ran pending migrations')
        : logger.log('ran migrations:', applied.map((m) => m.name).join(', '));
    }
    return applied;
  } finally {
    await runner.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => {});
    await runner.release();
  }
};

module.exports = { runPendingMigrations };
