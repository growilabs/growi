import { diag } from '@opentelemetry/api';
import type { IncomingMessage } from 'http';

import { ATTR_HTTP_TARGET } from '../../semconv';
import type { AnonymizationModule } from '../interfaces/anonymization-module';
import { anonymizeQueryParams } from '../utils/anonymize-query-params';

const logger = diag.createComponentLogger({
  namespace: 'growi:anonymization:page-listing-handler',
});

/**
 * Page listing API anonymization module
 */
export const pageListingApiModule: AnonymizationModule = {
  /**
   * Check if this module can handle page-listing API endpoints
   */
  canHandle(url: string): boolean {
    return (
      url.includes('/_api/v3/page-listing/ancestors-children') ||
      url.includes('/_api/v3/page-listing/children') ||
      url.includes('/_api/v3/page-listing/info')
    );
    // Add other page-listing endpoints here as needed
  },

  /**
   * Handle anonymization for page-listing API endpoints
   */
  handle(
    _request: IncomingMessage,
    url: string,
  ): Record<string, string> | null {
    const attributes: Record<string, string> = {};
    let hasAnonymization = false;

    // Handle ancestors-children endpoint
    if (
      url.includes('/_api/v3/page-listing/ancestors-children') ||
      url.includes('/_api/v3/page-listing/children') ||
      url.includes('/_api/v3/page-listing/info')
    ) {
      const anonymizedUrl = anonymizeQueryParams(url, ['path']);
      // Only set attributes if the URL was actually modified
      if (anonymizedUrl !== url) {
        attributes[ATTR_HTTP_TARGET] = anonymizedUrl;
        hasAnonymization = true;
        logger.debug(`Anonymized page-listing URL: ${url} -> ${anonymizedUrl}`);
      }
    }

    return hasAnonymization ? attributes : null;
  },
};
