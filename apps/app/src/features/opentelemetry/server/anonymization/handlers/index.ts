import { pageAccessModule } from '~/features/opentelemetry/server/anonymization/handlers/page-access-handler';
import { pageApiModule } from '~/features/opentelemetry/server/anonymization/handlers/page-api-handler';
import { pageListingApiModule } from '~/features/opentelemetry/server/anonymization/handlers/page-listing-api-handler';
import { searchApiModule } from '~/features/opentelemetry/server/anonymization/handlers/search-api-handler';

import type { AnonymizationModule } from '../interfaces/anonymization-module';

/**
 * List of anonymization modules
 */
export const anonymizationModules: AnonymizationModule[] = [
  searchApiModule,
  pageListingApiModule,
  pageApiModule,
  pageAccessModule,
];
