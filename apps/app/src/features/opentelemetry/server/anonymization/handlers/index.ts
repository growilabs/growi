import { pageAccessModule } from '~/features/opentelemetry/server/anonymization/handlers/page-access-handler.js';
import { pageApiModule } from '~/features/opentelemetry/server/anonymization/handlers/page-api-handler.js';
import { pageListingApiModule } from '~/features/opentelemetry/server/anonymization/handlers/page-listing-api-handler.js';
import { searchApiModule } from '~/features/opentelemetry/server/anonymization/handlers/search-api-handler.js';

import type { AnonymizationModule } from '../interfaces/anonymization-module.js';

/**
 * List of anonymization modules
 */
export const anonymizationModules: AnonymizationModule[] = [
  searchApiModule,
  pageListingApiModule,
  pageApiModule,
  pageAccessModule,
];
