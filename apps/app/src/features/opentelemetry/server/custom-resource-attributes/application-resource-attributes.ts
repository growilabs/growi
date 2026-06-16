import type { Attributes } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:opentelemetry:custom-resource-attributes:application',
);

/**
 * Get application fixed information as OpenTelemetry Resource Attributes
 * These attributes are static and set once during application startup
 */
export async function getApplicationResourceAttributes(): Promise<Attributes> {
  logger.info('Collecting application resource attributes');

  try {
    // Dynamic import to avoid circular dependencies
    const { growiInfoService } = await import('~/server/service/growi-info');

    const growiInfo = await growiInfoService.getGrowiInfo({});

    const attributes: Attributes = {
      // Service configuration (rarely changes after system setup)
      'growi.service.type': growiInfo.type,
      'growi.deployment.type': growiInfo.deploymentType,
    };

    logger.info({ attributes }, 'Application resource attributes collected');

    return attributes;
  } catch (error) {
    logger.error(
      { err: error },
      'Failed to collect application resource attributes',
    );
    return {};
  }
}
