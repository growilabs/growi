// Building the markdown notification body for GROWI's 6 notifiable events
// (design.md `NotificationContent` -- Requirements 2.1, 2.2, 2.3).
//
// design.md's "文面は NotificationContent が作る" note is the reason this module
// exists as a separate step from `NotificationOutbox.enqueue` (task 8.1, not
// yet built): `enqueue` receives an already-finished `markdown` string
// specifically because dropping a restricted page's body must happen HERE,
// before the outbox ever sees it -- `containsRestrictedPage` on the outbox
// entry is only a downstream signal for the proxy to record (Requirement
// 2.4's audit trail), never a second place where dropping happens. If this
// module forgot to drop the body, nothing later in the pipeline would catch
// it.
//
// Body embedding and diff construction intentionally replicate Gen 1's
// existing behavior (tasks.md: "本文の埋め込みと、更新時の差分の作り方は既存の振る舞いを
// そのまま残す"), not a new design. `server/util/slack.js` (202 lines) is
// design.md's own citation for this -- see `prepareAttachmentTextForCreate`/
// `prepareAttachmentTextForComment` (truncate at `EXCERPT_LENGTH`, append
// `...`) and `prepareAttachmentTextForUpdate` (`diff.diffLines`, added lines
// suffixed `:lower_left_fountain_pen:`, runs of >1 removed line summarized as
// `:wastebasket: ... N lines`, single-line removals and unchanged lines
// silently dropped). Both are reproduced verbatim below so a diff produced
// here has the exact same shape Gen 1 already produces -- this is a
// same-behavior port, not a reinterpretation.
//
// Only `pageCreate` and `pageEdit` carry a page-body excerpt/diff; `comment`
// carries the comment's own body (truncated the same way, per the same Gen 1
// file's `prepareAttachmentTextForComment`); `pageDelete`, `pageMove`, and
// `pageLike` are header-only -- there is no post-event body left to show for
// a deleted page, and Gen 1 itself never attached a body for move/like
// either (`generateAttachmentBody` in `global-notification-slack.ts` is an
// unconditional TODO stub returning '' for every event; it never
// differentiated by event at all).
//
// Unlike `LinkPreviewMapper` (`./link-preview-mapper.ts`), this module does
// NOT also gate on `isGuestAllowedToRead()`: design.md's table is explicit
// that a closed-GROWI notification "そのまま出す" (goes out unchanged) because
// its destination channel was deliberately configured by an operator, unlike
// link-preview's audience (anyone in the channel who happens to see a pasted
// URL).

import * as diff from 'diff';

import type { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';

import { EXCERPT_LENGTH } from './excerpt-length';
import type { PublicPageFilterSource } from './public-page-filter';
import { isPubliclyReadablePage } from './public-page-filter';

/** The 6 notifiable events (Requirement 2.1), reusing Gen 1's own event
 * vocabulary (`~/server/models/GlobalNotificationSetting/consts`) rather
 * than declaring a second, parallel list -- Gen 1 and Gen 2 notifications
 * fire from the same call site (design.md's Modified Files:
 * `server/service/global-notification/index.ts`), so they must agree on
 * what an "event" is. */
export type NotificationEventName =
  (typeof GlobalNotificationSettingEvent)[keyof typeof GlobalNotificationSettingEvent];

/** The page fields this module needs: the restriction judgment
 * (`PublicPageFilterSource`) plus the two fields it renders. */
export interface NotificationContentPageSource extends PublicPageFilterSource {
  readonly path: string;
  /** Current revision body. Read only for `pageCreate`/`pageEdit`; ignored
   * (never rendered) for the other 4 events. */
  readonly body: string;
}

export interface NotificationContentInput {
  readonly event: NotificationEventName;
  readonly page: NotificationContentPageSource;
  /** Absolute URL to the page, already resolved by the caller. */
  readonly pageUrl: string;
  readonly triggeredByUsername: string;
  /** Required for `pageMove`; the path the page moved FROM. */
  readonly oldPath?: string;
  /** Required for `comment`; the comment's own body. */
  readonly commentBody?: string;
  /**
   * Used for `pageEdit`'s diff. `undefined` means "no previous revision
   * available" -- matches Gen 1's `prepareAttachmentTextForUpdate`, which
   * returns no diff text at all in that case (NOT a full-body fallback).
   */
  readonly previousBody?: string;
}

export interface NotificationContentResult {
  readonly markdown: string;
  /**
   * Informational only, for the proxy's audit trail (Requirement 2.4) --
   * the actual dropping already happened in `markdown` above by the time
   * this is read. See the module-level note.
   */
  readonly containsRestrictedPage: boolean;
}

/** Same truncation Gen 1 applies to a page/comment body: cut at
 * `EXCERPT_LENGTH` characters, appending `...` when anything was cut. */
const truncate = (body: string): string =>
  body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH)}...` : body;

/**
 * Same diff construction as Gen 1's `prepareAttachmentTextForUpdate`
 * (`server/util/slack.js`): `diff.diffLines` over the previous and current
 * body, with added lines marked and runs of removed lines summarized --
 * never a full re-embed of the new body. Returns `''` when there is no
 * previous revision to diff against (Gen 1 returns `undefined` in that
 * case; an empty string keeps this module's `markdown` string concatenation
 * simple without changing the observable content).
 */
const buildDiffText = (
  previousBody: string | undefined,
  currentBody: string,
): string => {
  if (previousBody == null) {
    return '';
  }

  let diffText = '';
  for (const line of diff.diffLines(previousBody, currentBody)) {
    if (line.added) {
      diffText += `${line.value} ... :lower_left_fountain_pen:`;
    } else if (line.removed) {
      if ((line.count ?? 0) > 1) {
        diffText += `:wastebasket: ... ${line.count} lines\n`;
      }
    }
  }
  return diffText;
};

const header = (
  event: NotificationEventName,
  input: NotificationContentInput,
): string => {
  const { page, pageUrl, triggeredByUsername, oldPath } = input;
  const link = `[${page.path}](${pageUrl})`;

  switch (event) {
    case 'pageCreate':
      return `${triggeredByUsername} created ${link}`;
    case 'pageEdit':
      return `${triggeredByUsername} edited ${link}`;
    case 'pageDelete':
      return `${triggeredByUsername} deleted ${link}`;
    case 'pageMove':
      return `${triggeredByUsername} moved ${oldPath ?? '(unknown path)'} to ${link}`;
    case 'pageLike':
      return `${triggeredByUsername} liked ${link}`;
    case 'comment':
      return `${triggeredByUsername} commented on ${link}`;
    default: {
      // Exhaustiveness guard: a new event added to
      // `GlobalNotificationSettingEvent` without a case here is a compile
      // error, not a silent fallthrough.
      const exhaustive: never = event;
      throw new Error(`unhandled notification event: ${String(exhaustive)}`);
    }
  }
};

/** The body/diff section for events that carry one; `undefined` for the
 * header-only events (`pageDelete`, `pageMove`, `pageLike`). Restriction
 * dropping is applied by the caller, not here -- this only decides WHAT
 * content an unrestricted page/comment would show. */
const contentSection = (
  event: NotificationEventName,
  input: NotificationContentInput,
): string | undefined => {
  switch (event) {
    case 'pageCreate':
      return truncate(input.page.body);
    case 'pageEdit': {
      const diffText = buildDiffText(input.previousBody, input.page.body);
      return diffText === '' ? undefined : diffText;
    }
    case 'comment':
      return input.commentBody == null
        ? undefined
        : truncate(input.commentBody);
    case 'pageDelete':
    case 'pageMove':
    case 'pageLike':
      return undefined;
    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled notification event: ${String(exhaustive)}`);
    }
  }
};

/**
 * Builds the markdown notification body for one of the 6 notifiable events
 * (Requirement 2.1) and judges, per Requirement 2.3, whether the page's
 * body must be withheld -- the withholding happens in `markdown` itself,
 * not merely in the returned flag.
 */
export const buildNotificationContent = (
  input: NotificationContentInput,
): NotificationContentResult => {
  const containsRestrictedPage = !isPubliclyReadablePage(input.page);

  const headerLine = header(input.event, input);
  const body = containsRestrictedPage
    ? undefined
    : contentSection(input.event, input);

  const markdown = body == null ? headerLine : `${headerLine}\n\n${body}`;

  return { markdown, containsRestrictedPage };
};
