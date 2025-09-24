import { diag } from '@opentelemetry/api';
import type { IncomingMessage } from 'http';

import { ATTR_HTTP_TARGET } from '../../semconv';
import type { AnonymizationModule } from '../interfaces/anonymization-module';
import { anonymizeQueryParams } from '../utils/anonymize-query-params';

const logger = diag.createComponentLogger({
  namespace: 'growi:anonymization:page-api-handler',
});

/**
 * Page API anonymization module
 */
export const pageApiModule: AnonymizationModule = {
  /**
   * Check if this module can handle page API endpoints
   */
  canHandle(url: string): boolean {
    return (
      url.includes('/_api/v3/pages/list') ||
      url.includes('/_api/v3/pages/subordinated-list') ||
      url.includes('/_api/v3/page/check-page-existence') ||
      url.includes('/_api/v3/page/get-page-paths-with-descendant-count')
    );
  },

  /**
   * Handle anonymization for page API endpoints
   */
  handle(request: IncomingMessage, url: string): Record<string, string> | null {
    const attributes: Record<string, string> = {};
    let hasAnonymization = false;

    // Handle endpoints with 'path' parameter
    if (
      url.includes('path=') &&
      (url.includes('/_api/v3/pages/list') ||
        url.includes('/_api/v3/pages/subordinated-list') ||
        url.includes('/_api/v3/page/check-page-existence'))
    ) {
      const anonymizedUrl = anonymizeQueryParams(url, ['path']);
      attributes[ATTR_HTTP_TARGET] = anonymizedUrl;
      hasAnonymization = true;

      // Determine endpoint type for logging
      let endpointType = 'page API';
      if (url.includes('/_api/v3/pages/list')) endpointType = '/pages/list';
      else if (url.includes('/_api/v3/pages/subordinated-list'))
        endpointType = '/pages/subordinated-list';
      else if (url.includes('/_api/v3/page/check-page-existence'))
        endpointType = '/page/check-page-existence';

      logger.debug(
        `Anonymized ${endpointType} URL: ${url} -> ${anonymizedUrl}`,
      );
    }

    // Handle page/get-page-paths-with-descendant-count endpoint with paths parameter
    if (
      url.includes('/_api/v3/page/get-page-paths-with-descendant-count') &&
      url.includes('paths=')
    ) {
      const anonymizedUrl = anonymizeQueryParams(url, ['paths']);
      attributes[ATTR_HTTP_TARGET] = anonymizedUrl;
      hasAnonymization = true;
      logger.debug(
        `Anonymized page/get-page-paths-with-descendant-count URL: ${url} -> ${anonymizedUrl}`,
      );
    }

    return hasAnonymization ? attributes : null;
  },
};
