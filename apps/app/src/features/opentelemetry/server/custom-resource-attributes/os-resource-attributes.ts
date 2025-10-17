import * as os from 'node:os';

import type { Attributes } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:opentelemetry:custom-resource-attributes:os',
);

/**
 * Get OS information as OpenTelemetry Resource Attributes
 * These attributes are static and set once during application startup
 */
export function getOsResourceAttributes(): Attributes {
  logger.info('Collecting OS resource attributes');

  const osInfo = {
    type: os.type(),
    platform: os.platform(),
    arch: os.arch(),
    totalmem: os.totalmem(),
  };

  const attributes: Attributes = {
    'os.type': osInfo.type,
    'os.platform': osInfo.platform,
    'os.arch': osInfo.arch,
    'os.totalmem': osInfo.totalmem,
  };

  logger.info('OS resource attributes collected', { attributes });

  return attributes;
}
