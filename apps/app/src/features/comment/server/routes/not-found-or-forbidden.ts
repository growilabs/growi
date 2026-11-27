import { ErrorV3 } from '@growi/core/dist/models';

// One uniform body for every "missing" and "not allowed" case, so the
// response never tells which one it was (rules/page-write-action-403-404.md).
export const notFoundOrForbidden = (): ErrorV3 =>
  new ErrorV3('Page is not found or forbidden', 'notfound_or_forbidden');
