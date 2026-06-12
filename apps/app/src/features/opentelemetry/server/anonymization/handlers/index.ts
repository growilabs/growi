import type { AnonymizationModule } from '../interfaces/anonymization-module.js';
import { pageAccessModule } from './page-access-handler.js';
import { pageApiModule } from './page-api-handler.js';
import { pageListingApiModule } from './page-listing-api-handler.js';
import { searchApiModule } from './search-api-handler.js';

/**
 * List of anonymization modules
 */
export const anonymizationModules: AnonymizationModule[] = [
  searchApiModule,
  pageListingApiModule,
  pageApiModule,
  pageAccessModule,
];
