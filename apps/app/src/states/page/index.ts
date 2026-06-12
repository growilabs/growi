/**
 * Page state management - Public API
 *
 * This module provides a clean interface for page state management,
 * hiding internal implementation details while exposing only the necessary hooks.
 */

export * from './hooks.js';
export {
  _atomsForDerivedAbilities,
  _atomsForSyncRevisionIdFromUrl,
} from './internal-atoms.js';
export { useCurrentPageLoading } from './use-current-page-loading.js';
// Data fetching hooks
export { useFetchCurrentPage } from './use-fetch-current-page.js';
export * from './use-set-remote-latest-page-data.js';
