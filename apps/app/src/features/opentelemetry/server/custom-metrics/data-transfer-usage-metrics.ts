import { type Counter, diag, metrics } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:opentelemetry:custom-metrics:data-transfer-usage',
);
const loggerDiag = diag.createComponentLogger({
  namespace: 'growi:custom-metrics:data-transfer-usage',
});

export type ArchiveOperation = 'create' | 'download' | 'upload' | 'import';
export type G2GTransferRole = 'source' | 'destination';
export type OperationResult = 'success' | 'failure';

// Created after SDK start: @opentelemetry/api has no metrics proxy, so a Meter
// obtained before the provider is registered stays Noop forever.
let archiveOperationsCounter: Counter | undefined;
let g2gTransferOperationsCounter: Counter | undefined;

export function addDataTransferUsageMetrics(): void {
  logger.info('Starting data transfer usage metrics collection');

  const meter = metrics.getMeter('growi-data-transfer-usage-metrics', '1.0.0');

  archiveOperationsCounter = meter.createCounter('growi.archive.operations', {
    description: 'Number of data archive operations attempted',
    unit: '{operation}',
  });
  g2gTransferOperationsCounter = meter.createCounter(
    'growi.g2g_transfer.operations',
    {
      description: 'Number of GROWI-to-GROWI transfers attempted',
      unit: '{transfer}',
    },
  );

  logger.info('Data transfer usage metrics collection started successfully');
}

export function recordArchiveOperation(
  operation: ArchiveOperation,
  result: OperationResult,
): void {
  try {
    archiveOperationsCounter?.add(1, { operation, result });
  } catch (error) {
    loggerDiag.error('Failed to record archive operation', { error });
  }
}

export function recordG2GTransfer(
  role: G2GTransferRole,
  result: OperationResult,
): void {
  try {
    g2gTransferOperationsCounter?.add(1, { role, result });
  } catch (error) {
    loggerDiag.error('Failed to record G2G transfer', { error });
  }
}
