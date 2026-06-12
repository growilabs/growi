import * as os from 'node:os';
import * as v8 from 'node:v8';
import { diag, metrics } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:opentelemetry:custom-metrics:system');
const loggerDiag = diag.createComponentLogger({
  namespace: 'growi:custom-metrics:system',
});

export function addSystemMetrics(): void {
  logger.info('Starting system metrics collection');

  const meter = metrics.getMeter('growi-system-metrics', '1.0.0');

  const memoryLimitGauge = meter.createObservableGauge('system.memory.limit', {
    description: 'Container or OS-imposed memory limit for this process',
    unit: 'By',
  });
  const hostMemoryTotalGauge = meter.createObservableGauge(
    'system.host.memory.total',
    {
      description: 'Total physical memory available on the host',
      unit: 'By',
    },
  );
  const processMemoryUsageGauge = meter.createObservableGauge(
    'process.memory.usage',
    {
      description: 'Resident Set Size — physical memory in use by this process',
      unit: 'By',
    },
  );
  const v8HeapUsedGauge = meter.createObservableGauge(
    'process.runtime.v8.heap.used',
    {
      description: 'V8 heap memory currently in use',
      unit: 'By',
    },
  );
  const v8HeapTotalGauge = meter.createObservableGauge(
    'process.runtime.v8.heap.total',
    {
      description: 'Total V8 heap memory allocated',
      unit: 'By',
    },
  );
  const v8HeapExternalGauge = meter.createObservableGauge(
    'process.runtime.v8.heap.external',
    {
      description: 'External memory referenced by V8 objects (e.g. Buffers)',
      unit: 'By',
    },
  );

  meter.addBatchObservableCallback(
    async (result) => {
      try {
        // process.constrainedMemory() is available in Node.js >=19.6.0.
        // On older versions it may not exist; guard with a falsy check.
        const constrainedMemory =
          (
            process as NodeJS.Process & { constrainedMemory?(): number }
          ).constrainedMemory?.() ?? 0;
        // Call each system API exactly once per collection cycle.
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();

        if (constrainedMemory) {
          result.observe(memoryLimitGauge, constrainedMemory);
        }
        result.observe(hostMemoryTotalGauge, os.totalmem());
        result.observe(processMemoryUsageGauge, memUsage.rss);
        result.observe(v8HeapUsedGauge, heapStats.used_heap_size);
        result.observe(v8HeapTotalGauge, heapStats.total_heap_size);
        result.observe(v8HeapExternalGauge, memUsage.external);
      } catch (error) {
        loggerDiag.error('Failed to collect system metrics', { error });
      }
    },
    [
      memoryLimitGauge,
      hostMemoryTotalGauge,
      processMemoryUsageGauge,
      v8HeapUsedGauge,
      v8HeapTotalGauge,
      v8HeapExternalGauge,
    ],
  );

  logger.info('System metrics collection started successfully');
}
