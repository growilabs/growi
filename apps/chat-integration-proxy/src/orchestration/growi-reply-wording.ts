// What the requester is told about a command one GROWI answered, worded once
// for every flow that sends a command to a single GROWI (`command-flow.ts` and
// `agent-flow.ts`).
import type { OutboundMessage } from '../types/index.js';

export const markdown = (text: string): OutboundMessage => ({
  kind: 'markdown',
  markdown: text,
});

/**
 * The ONE rendering of "you need to link your account with this GROWI".
 *
 * `growiLabel` is always named, not only where several GROWIs are linked: a
 * link is granted by one GROWI alone (Requirement 7.2), and a user who cannot
 * tell which one asked will tie the wrong account. Naming it unconditionally
 * also means the wording does not depend on a count this function would
 * otherwise have to be told.
 */
export const accountLinkNotice = (
  growiLabel: string,
  linkUrl: string,
): OutboundMessage =>
  markdown(
    `GROWI「${growiLabel}」との紐付けが必要です。次のリンクを開き、その GROWI にログインした状態で紐付けを承認してください（1 回だけ使えます。短時間で失効します）:\n\n<${linkUrl}>`,
  );

export const refusedNotice = (
  growiLabel: string,
  reason: string,
): OutboundMessage =>
  markdown(`GROWI「${growiLabel}」で実行できませんでした: ${reason}`);

export const notDeliveredNotice = (growiLabel: string): OutboundMessage =>
  markdown(`GROWI「${growiLabel}」に届きませんでした。`);

export const unexpectedAnswerNotice = (growiLabel: string): OutboundMessage =>
  markdown(`GROWI「${growiLabel}」から想定外の応答が返りました。`);

export const notUsableNotice = (word: string): OutboundMessage =>
  markdown(`\`${word}\` は今使えません。`);
