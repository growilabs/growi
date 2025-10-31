import type { AnonymizationModule } from '../interfaces/anonymization-module';
import { pageAccessModule } from './page-access-handler';
import { pageApiModule } from './page-api-handler';
import { pageListingApiModule } from './page-listing-api-handler';
import { searchApiModule } from './search-api-handler';

/**
 * List of anonymization modules
 */
export const anonymizationModules: AnonymizationModule[] = [
  searchApiModule,
  pageListingApiModule,
  pageApiModule,
  pageAccessModule,
];
