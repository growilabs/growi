import { diag, metrics } from '@opentelemetry/api';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory(
  'growi:opentelemetry:custom-metrics:mongoose-connection-pool',
);
const loggerDiag = diag.createComponentLogger({
  namespace: 'growi:custom-metrics:mongoose-connection-pool',
});

// Internal pool shape accessed via topology internals (mongodb driver 4.x).
// Wrapped in try/catch so metrics degrade gracefully if the driver changes.
type ServerPool = {
  totalConnectionCount?: number;
  currentCheckedOutCount?: number;
  availableConnectionCount?: number;
};

type ServerInternal = { s?: { pool?: ServerPool } };

type TopologyInternal = { s?: { servers?: Map<string, ServerInternal> } };

export type PoolStats = {
  total: number;
  checkedOut: number;
  available: number;
};

/**
 * Reads current connection pool stats from the mongodb driver topology.
 * Sums across all servers (typically one in a standalone/replica-set primary scenario).
 * Returns zeros if the topology internals are not accessible.
 */
export function getPoolStats(client: {
  topology?: TopologyInternal;
}): PoolStats {
  try {
    const servers = client.topology?.s?.servers;
    if (!servers) return { total: 0, checkedOut: 0, available: 0 };

    let total = 0;
    let checkedOut = 0;
    let available = 0;

    for (const server of servers.values()) {
      const pool = server?.s?.pool;
      if (pool) {
        total += pool.totalConnectionCount ?? 0;
        checkedOut += pool.currentCheckedOutCount ?? 0;
        available += pool.availableConnectionCount ?? 0;
      }
    }

    return { total, checkedOut, available };
  } catch {
    return { total: 0, checkedOut: 0, available: 0 };
  }
}

export function addMongooseConnectionPoolMetrics(): void {
  logger.info('Starting mongoose connection pool metrics collection');

  const client = mongoose.connection.getClient();
  if (client == null) {
    logger.warn(
      'Mongoose client not available; skipping connection pool metrics',
    );
    return;
  }

  const meter = metrics.getMeter('growi-mongoose-metrics', '1.0.0');

  const poolSizeGauge = meter.createObservableGauge(
    'growi.mongoose.pool.size',
    {
      description:
        'Total number of connections in the MongoDB connection pool (available + pending + checked out)',
      unit: '{connection}',
    },
  );
  const checkedOutGauge = meter.createObservableGauge(
    'growi.mongoose.pool.checked_out',
    {
      description:
        'Number of MongoDB connections currently checked out (in use)',
      unit: '{connection}',
    },
  );
  const availableGauge = meter.createObservableGauge(
    'growi.mongoose.pool.available',
    {
      description:
        'Number of MongoDB connections currently available in the pool',
      unit: '{connection}',
    },
  );

  meter.addBatchObservableCallback(
    (result) => {
      try {
        const stats = getPoolStats(client as { topology?: TopologyInternal });
        result.observe(poolSizeGauge, stats.total);
        result.observe(checkedOutGauge, stats.checkedOut);
        result.observe(availableGauge, stats.available);
      } catch (error) {
        loggerDiag.error('Failed to collect mongoose connection pool metrics', {
          error,
        });
      }
    },
    [poolSizeGauge, checkedOutGauge, availableGauge],
  );

  logger.info(
    'Mongoose connection pool metrics collection started successfully',
  );
}
