// Task 4.1: 「どちらの入り口から来ても同じ形になる」(決定 4) is the TARGET
// design -- but it is not what `normalize` does today (Task 12.2's finding).
// A real slash-command event's `command` field always carries its leading
// `/` (confirmed against `@chat-adapter/slack`'s and `@chat-adapter/discord`'s
// actual payload construction: Slack copies Slack's own `command` form
// parameter verbatim, e.g. `"/growi"`; Discord explicitly prefixes the
// interaction's command name with `/` if it is missing one). `normalize`
// only `.trim()`s a slash-command's `command` -- it never strips that `/` --
// so today's actual output does NOT match what the same content produces via
// a mention. The fixtures below use the leading-`/` shape a real adapter
// sends, and the first case asserts the honest (non-equal) current result
// rather than the target-design equality, so this file does not report a
// false pass for a capability (`slashCommand`) `platform-capabilities.ts`
// correctly marks `none` (see task 12.2 for the paired capability-table fix).
// Making the two paths actually converge -- e.g. by stripping a leading `/`
// from `command` before use -- is left to a future task.
import type { ChannelRef, ChatAccountRef } from '@growi/chat';

import type { InteractionRef } from '../types/index.js';
import { CommandInvocation } from './invocation.js';

const channel: ChannelRef = {
  platform: 'slack',
  channelId: 'C0001',
  channelName: 'general',
  isPrivate: false,
};

const actor: ChatAccountRef = {
  platform: 'slack',
  accountId: 'U0001',
  displayName: 'Alice Example',
};

const trigger: InteractionRef = { token: 'trigger-1' };

describe('CommandInvocation.normalize', () => {
  it('does NOT produce the same Invocation for a mention and a slash command carrying equivalent content, because a real slash-command payload keeps its leading `/`', () => {
    const fromMention = CommandInvocation.normalize({
      kind: 'mention',
      platform: 'slack',
      channel,
      actor,
      text: '@growi search foo',
      interaction: null,
    });

    // A real Slack slash-command payload (`@chat-adapter/slack`, confirmed
    // against its actual `command: params.get('command')` construction)
    // reports `command` as the whole registered slash command including its
    // `/`, e.g. `/growi`, with the user's words in `text` -- NOT a bare
    // command word with no slash, which is what this fixture used before
    // Task 12.2 (the old fixture's `command: 'search'` never occurs in
    // practice, which let this test pass while proving nothing about real
    // input).
    const fromSlashCommand = CommandInvocation.normalize({
      kind: 'slash-command',
      platform: 'slack',
      channel,
      actor,
      command: '/growi',
      text: 'search foo',
      interaction: null,
    });

    expect(fromMention).toEqual({
      platform: 'slack',
      channel,
      actor,
      commandName: 'search',
      argsText: 'foo',
      interaction: null,
    });
    // The honest current result: `/growi` (the whole slash command, `/`
    // included) becomes the commandName verbatim, and none of the general or
    // admin vocabularies (`admin-command-set.ts`'s ADMIN_COMMAND_WORDS,
    // etc.) contain a `/`-prefixed word, so this can never resolve to a real
    // command today -- exactly why `platform-capabilities.ts` now marks
    // Slack's and Discord's `slashCommand` as `none`.
    expect(fromSlashCommand).toEqual({
      platform: 'slack',
      channel,
      actor,
      commandName: '/growi',
      argsText: 'search foo',
      interaction: null,
    });
    expect(fromMention).not.toEqual(fromSlashCommand);
  });

  it('strips the mention address token before splitting the command name off the remaining text', () => {
    const result = CommandInvocation.normalize({
      kind: 'mention',
      platform: 'slack',
      channel,
      actor,
      text: '@growi keep https://growi.example.com/page',
      interaction: null,
    });

    expect(result.commandName).toBe('keep');
    expect(result.argsText).toBe('https://growi.example.com/page');
  });

  it('produces an empty commandName and argsText for a mention with no command word, without throwing', () => {
    const result = CommandInvocation.normalize({
      kind: 'mention',
      platform: 'slack',
      channel,
      actor,
      text: '@growi',
      interaction: null,
    });

    expect(result.commandName).toBe('');
    expect(result.argsText).toBe('');
  });

  it('carries the interaction handle through unchanged for a slash command', () => {
    const result = CommandInvocation.normalize({
      kind: 'slash-command',
      platform: 'slack',
      channel,
      actor,
      // Leading `/` kept, matching the real adapter shape (see the first
      // test above) -- not the pre-12.2 fixture's bare `add-growi`.
      command: '/add-growi',
      text: '',
      interaction: trigger,
    });

    expect(result.interaction).toBe(trigger);
    expect(result.commandName).toBe('/add-growi');
    expect(result.argsText).toBe('');
  });
});
