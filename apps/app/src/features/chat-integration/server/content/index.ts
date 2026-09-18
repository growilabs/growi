// Public surface of the "what GROWI sends out" layer (design.md's `content/`).
// This is the layer's final task (4.5): every module under this directory is
// complete, so this barrel is now the layer's whole intentional public
// surface, curated deliberately rather than a blanket re-export of every
// internal file. `./excerpt-length.ts` is a deliberate omission -- it is an
// implementation detail shared between `link-preview-mapper.ts` and
// `notification-content.ts` within this directory, not something any caller
// outside `content/` needs to name.
//
// The two `viewer-page-filter` types are re-exported because the caller of
// `filterPagesForViewer` builds both of its inputs -- the actor it got from
// `resolveActor` and the candidate list it built from the search hits -- and
// so has to name them.

export { buildConversationPageBody } from './conversation-page';
export type { HelpCommandEntry } from './help-content';
export { buildHelpContent } from './help-content';
export type {
  LinkPreviewPageSource,
  LinkPreviewResult,
} from './link-preview-mapper';
export { buildLinkPreview } from './link-preview-mapper';
export type {
  NotificationContentInput,
  NotificationContentPageSource,
  NotificationContentResult,
  NotificationEventName,
} from './notification-content';
export { buildNotificationContent } from './notification-content';
export type { PublicPageFilterSource } from './public-page-filter';
export { isPubliclyReadablePage } from './public-page-filter';
export type { SearchResultPageSource } from './search-result-mapper';
export { mapToSearchResultItems } from './search-result-mapper';
export type {
  PageCandidate,
  ViewerFilterActor,
} from './viewer-page-filter';
export {
  filterPagesForViewer,
  OVER_FETCH_FACTOR,
  overFetchCount,
} from './viewer-page-filter';
