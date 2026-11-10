// The character length used to truncate an embedded page body excerpt,
// shared by `NotificationContent` (`./notification-content.ts`, task 4.5)
// and `LinkPreviewMapper` (`./link-preview-mapper.ts`, task 4.4).
//
// Authoritative source: Gen 1's `server/util/slack.js` (202 lines),
// `prepareAttachmentTextForCreate`/`prepareAttachmentTextForComment`, which
// truncate a page/comment body at 2000 characters and append `...`.
// design.md cites this length explicitly only for `NotificationContent`
// ("Gen 1 では server/util/slack.js（202 行）が本文を 2000 文字で切って埋め込み");
// `LinkPreviewMapper` had borrowed the same number by analogy before this
// constant existed (see tasks.md's Implementation Notes for task 4.4).
// Declaring it once here means the two mappers can no longer drift apart
// silently if one changes.
export const EXCERPT_LENGTH = 2000;
