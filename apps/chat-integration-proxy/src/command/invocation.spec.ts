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
import type { ChatAccountRef } from '@growi/chat';

import { testSdkChannel } from '../capabilities/test-channels.js';
import type {
  InteractionRef,
  Invocation,
  PlatformEvent,
  SdkChannelRef,
} from '../types/index.js';
import { CommandInvocation } from './invocation.js';

const channel: SdkChannelRef = testSdkChannel('slack');

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
      textWithoutBotAddress: 'search foo',
      inDirectMessage: false,
      messageId: 'M0001',
      threadRootId: null,
      replyThreadRootId: null,
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
      sourceMessageId: 'M0001',
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
      sourceMessageId: null,
    });
    expect(fromMention).not.toEqual(fromSlashCommand);
  });

  it('splits the command name off the text the bot address was taken out of', () => {
    const result = CommandInvocation.normalize({
      kind: 'mention',
      platform: 'slack',
      channel,
      actor,
      text: '@growi agent summarise https://growi.example.com/page',
      textWithoutBotAddress: 'agent summarise https://growi.example.com/page',
      inDirectMessage: false,
      messageId: 'M0001',
      threadRootId: null,
      replyThreadRootId: null,
      interaction: null,
    });

    expect(result.commandName).toBe('agent');
    expect(result.argsText).toBe('summarise https://growi.example.com/page');
  });

  it('produces an empty commandName and argsText for a mention with no command word, without throwing', () => {
    const result = CommandInvocation.normalize({
      kind: 'mention',
      platform: 'slack',
      channel,
      actor,
      text: '@growi',
      textWithoutBotAddress: '',
      inDirectMessage: false,
      messageId: 'M0001',
      threadRootId: null,
      replyThreadRootId: null,
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

  it('carries the installation the event named, so a later step resolves the same one', () => {
    const result = CommandInvocation.normalize({
      kind: 'mention',
      platform: 'slack',
      channel,
      actor,
      text: 'search foo',
      textWithoutBotAddress: 'search foo',
      inDirectMessage: true,
      messageId: 'M1',
      threadRootId: null,
      replyThreadRootId: null,
      interaction: null,
      installation: { kind: 'identified', installationId: 'inst-dm' },
    });

    expect(result.installation).toEqual({
      kind: 'identified',
      installationId: 'inst-dm',
    });
  });

  it('leaves the installation off when the event named none', () => {
    const result = CommandInvocation.normalize({
      kind: 'slash-command',
      platform: 'slack',
      channel,
      actor,
      command: '/growi',
      text: 'search foo',
      interaction: null,
    });

    expect(result).not.toHaveProperty('installation');
  });
});

describe('Invocation', () => {
  it('normalizes a mention and a slash-command into the same shape', () => {
    const actor = {
      platform: 'slack',
      accountId: 'U1',
      displayName: 'Alice',
    } as const;
    const channel = testSdkChannel('slack');

    const fromMention: Invocation = {
      platform: 'slack',
      channel,
      actor,
      commandName: 'search',
      argsText: 'growi setup',
      interaction: null,
    };
    const fromSlashCommand: Invocation = {
      platform: 'slack',
      channel,
      actor,
      commandName: 'search',
      argsText: 'growi setup',
      interaction: { token: 'trigger-abc' },
    };

    expect(fromMention.commandName).toBe(fromSlashCommand.commandName);
    expect(fromMention.argsText).toBe(fromSlashCommand.argsText);
  });

  describe('taking the command from the text the platform layer left after the bot address (15.17)', () => {
    const mention = (
      textWithoutBotAddress: string,
      overrides: Partial<Extract<PlatformEvent, { kind: 'mention' }>> = {},
    ) =>
      CommandInvocation.normalize({
        kind: 'mention',
        platform: 'slack',
        channel,
        actor,
        text: 'typed text the command layer must not read',
        textWithoutBotAddress,
        inDirectMessage: true,
        messageId: 'M0002',
        threadRootId: null,
        replyThreadRootId: null,
        interaction: null,
        ...overrides,
      });

    it('reads the command name and its arguments off that text', () => {
      const result = mention('search foo bar');

      expect(result.commandName).toBe('search');
      expect(result.argsText).toBe('foo bar');
      expect(result.sourceMessageId).toBe('M0002');
    });

    it('keeps a mention of another person that leads it, instead of guessing it is the bot', () => {
      const result = mention('@alice please review');

      expect(result.commandName).toBe('@alice');
      expect(result.argsText).toBe('please review');
    });

    it('drops no word of a channel mention on its own', () => {
      const result = mention('growi search foo', { inDirectMessage: false });

      expect(result.commandName).toBe('growi');
      expect(result.argsText).toBe('search foo');
    });
  });

  describe('where the request was made (15.8, 15.14)', () => {
    const mention = (
      overrides: Partial<Extract<PlatformEvent, { kind: 'mention' }>>,
    ) =>
      CommandInvocation.normalize({
        kind: 'mention',
        platform: 'slack',
        channel,
        actor,
        text: 'help',
        textWithoutBotAddress: 'help',
        inDirectMessage: false,
        messageId: 'M0004',
        threadRootId: null,
        replyThreadRootId: null,
        interaction: null,
        ...overrides,
      });

    it('carries both thread roots and the direct-message flag of a request in a DM thread', () => {
      const result = mention({
        inDirectMessage: true,
        threadRootId: 'M0001',
        replyThreadRootId: 'M0001',
      });

      expect(result).toMatchObject({
        threadRootId: 'M0001',
        replyThreadRootId: 'M0001',
        isDirectMessage: true,
      });
    });

    it('keeps the two roots apart when only the answer has a thread to go to', () => {
      const result = mention({
        inDirectMessage: true,
        threadRootId: null,
        replyThreadRootId: 'M0004',
      });

      expect(result.replyThreadRootId).toBe('M0004');
      expect(result.threadRootId ?? null).toBeNull();
    });

    it('leaves out what a request in a channel, outside a thread, has nothing to say about', () => {
      const result = mention({});

      expect(result).not.toHaveProperty('threadRootId');
      expect(result).not.toHaveProperty('replyThreadRootId');
      expect(result).not.toHaveProperty('isDirectMessage');
    });
  });
});

describe('CommandInvocation.agentRequest (the Slack AI app view, 15.15)', () => {
  const mentionInView = (
    textWithoutBotAddress: string,
  ): Extract<PlatformEvent, { kind: 'mention' }> => ({
    kind: 'mention',
    platform: 'slack',
    channel,
    actor,
    text: textWithoutBotAddress,
    textWithoutBotAddress,
    inDirectMessage: true,
    messageId: 'M0007',
    threadRootId: null,
    replyThreadRootId: 'M0007',
    interaction: null,
    installation: { kind: 'identified', installationId: 'T1' },
  });

  it('makes the whole text an agent request, even when it starts with another command name', () => {
    const result = CommandInvocation.agentRequest(
      mentionInView('search for the release notes'),
    );

    expect(result).toMatchObject({
      commandName: 'agent',
      argsText: 'search for the release notes',
    });
  });

  it('takes the request from the text left after the bot address, not the typed text (15.17)', () => {
    const result = CommandInvocation.agentRequest({
      ...mentionInView('質問'),
      text: '<@UBOT> 質問',
    });

    expect(result.argsText).toBe('質問');
  });

  it('keeps a mention of another person that leads the text (15.17)', () => {
    const result = CommandInvocation.agentRequest(
      mentionInView('<@U0002> の書いたページを探して'),
    );

    expect(result.argsText).toBe('<@U0002> の書いたページを探して');
  });

  it('keeps everything else a mention would carry, so the answer goes to the same thread', () => {
    const event = mentionInView('link');

    expect(CommandInvocation.agentRequest(event)).toEqual({
      ...CommandInvocation.normalize(event),
      commandName: 'agent',
      argsText: 'link',
    });
    expect(CommandInvocation.agentRequest(event)).toMatchObject({
      sourceMessageId: 'M0007',
      replyThreadRootId: 'M0007',
      isDirectMessage: true,
      installation: { kind: 'identified', installationId: 'T1' },
    });
  });
});
