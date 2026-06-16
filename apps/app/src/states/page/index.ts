/**
 * Page state management - Public API
 *
 * This module provides a clean interface for page state management,
 * hiding internal implementation details while exposing only the necessary hooks.
 */

export * from '~/states/page/hooks';
export {
  _atomsForDerivedAbilities,
  _atomsForSyncRevisionIdFromUrl,
} from '~/states/page/internal-atoms';
export { useCurrentPageLoading } from '~/states/page/use-current-page-loading';
// Data fetching hooks
export { useFetchCurrentPage } from '~/states/page/use-fetch-current-page';
export * from '~/states/page/use-set-remote-latest-page-data';
