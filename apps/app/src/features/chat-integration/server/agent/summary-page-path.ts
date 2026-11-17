// Where the summary page goes (design.md SummaryPage, Requirement 5.10).

import { type IUser, PageGrant } from '@growi/core';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import { format } from 'date-fns';

import { memoAreaPath } from '~/features/ai-tools/suggest-path/server/services/memo-area-path';

export interface SummaryPageTarget {
  readonly path: string;
  /** `undefined` leaves the grant to page creation's default, as `create-page` does. */
  readonly grant: PageGrant | undefined;
}

const MAX_TITLE_LENGTH = 100;
const FALLBACK_TITLE = 'Chat summary';

/**
 * Slashes would nest the page; the rest are the characters GROWI's
 * `isCreatablePage` rejects anywhere in a path, plus control characters.
 */
const CHARACTERS_NOT_IN_TITLE = /[/\\^$*+#<>%?\p{Cc}]+/gu;
/** `isCreatablePage` rejects a path ending in `.md`. */
const TRAILING_MD = /(\s*\.md)+$/;

const toPageTitle = (title: string): string => {
  const cleaned = title
    .replace(CHARACTERS_NOT_IN_TITLE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // By code point, so a character outside the BMP is never cut in half.
  const cut = Array.from(cleaned).slice(0, MAX_TITLE_LENGTH).join('');
  const result = cut.trim().replace(TRAILING_MD, '').trim();
  return result === '' ? FALLBACK_TITLE : result;
};

/**
 * A requested path is only normalised here; whether a page may be created
 * there is judged by page creation, the same way as for `create-page`.
 * Without one, the page goes to the user's memo area, the same place
 * suggest-path offers (`/memo/<username>/` when user pages are disabled).
 * The date is the server's local date of `now`.
 */
export const decideSummaryPath = (input: {
  readonly requestedPath: string | null;
  readonly user: Pick<IUser, 'username'>;
  readonly title: string;
  readonly now: Date;
  /** The `security:disableUserPages` setting. */
  readonly disableUserPages: boolean;
}): SummaryPageTarget => {
  const requestedPath = input.requestedPath?.trim() ?? '';
  if (requestedPath !== '') {
    return { path: normalizePath(requestedPath), grant: undefined };
  }

  const date = format(input.now, 'yyyy-MM-dd');
  return {
    path: `${memoAreaPath(input.user, input.disableUserPages)}${date} ${toPageTitle(input.title)}`,
    grant: PageGrant.GRANT_OWNER,
  };
};
