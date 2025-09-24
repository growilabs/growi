import type { IncomingMessage } from 'node:http';
import { diag } from '@opentelemetry/api';

import { ATTR_HTTP_TARGET } from '../../semconv';
import type { AnonymizationModule } from '../interfaces/anonymization-module';
import { anonymizeQueryParams } from '../utils/anonymize-query-params';

const logger = diag.createComponentLogger({
  namespace: 'growi:anonymization:search-handler',
});

/**
 * Search API anonymization module
 */
export const searchApiModule: AnonymizationModule = {
  /**
   * Check if this module can handle search API endpoints
   */
  canHandle(url: string): boolean {
    // More precise matching to avoid false positives
    return (
      url.match(/\/_api\/search(\?|$)/) !== null ||
      url.match(/\/_search(\?|$)/) !== null ||
      url.includes('/_api/search/') ||
      url.includes('/_search/')
    );
  },

  /**
   * Handle anonymization for search API endpoints
   */
  handle(request: IncomingMessage, url: string): Record<string, string> | null {
    // Check if this is a search request that needs anonymization
    // Look for q parameter anywhere in the query string
    if (url.includes('?q=') || url.includes('&q=')) {
      const anonymizedUrl = anonymizeQueryParams(url, ['q']);

      logger.debug(`Anonymized search API URL: ${url} -> ${anonymizedUrl}`);

      return {
        [ATTR_HTTP_TARGET]: anonymizedUrl,
      };
    }

    return null;
  },
};
