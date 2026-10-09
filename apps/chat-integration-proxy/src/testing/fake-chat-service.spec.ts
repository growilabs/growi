// What `createFakeChatService` promises to tasks 11.2-11.5: the four services'
// events can be pushed into the proxy, and everything the proxy sends back to
// a chat user can be read out afterwards.
//
// The contract under test is the `PlatformFacade` one, not this file's own
// storage: each test pushes an event in and reads the effect out through the
// same interface `orchestration/` uses, so the harness stays usable however it
// keeps its records.

import type { PlatformName } from '@growi/chat';
import { describe, expect, it } from 'vitest';

import type { PlatformEvent } from '../types/index.js';
import { channelOn, mentionOn, modalSubmitOn } from './chat-events.js';
import { createFakeChatService } from './fake-chat-service.js';

const PLATFORMS: ReadonlyArray<PlatformName> = [
  'slack',
  'discord',
  'teams',
  'mattermost',
];

/** Builds the facade and hands back the sink the proxy would have attached. */
const attached = async () => {
  const chat = createFakeChatService();
  const received: PlatformEvent[] = [];
  const facade = await chat.createFacade(
    { stateConnectionString: 'unused' },
    { list: () => Promise.resolve([]), resolve: () => Promise.resolve(null) },
    {
      handle: (event) => {
        received.push(event);
        return Promise.resolve();
      },
    },
  );
  return { chat, facade, received };
};

describe('injecting events', () => {
  it.each(
    PLATFORMS,
  )('delivers a %s mention to the proxy unchanged', async (platform) => {
    const { chat, received } = await attached();

    const event = mentionOn(platform, { text: 'create-page' });
    await chat.emit(event);

    expect(received).toEqual([event]);
  });

  it('refuses to deliver an event before the proxy has attached its sink', async () => {
    const chat = createFakeChatService();

    // Silently dropping it would make a mis-ordered test look like a proxy that
    // ignored the event, which is the hardest kind of failure to read.
    await expect(
      chat.emit(mentionOn('slack', { text: 'help' })),
    ).rejects.toThrow(/no proxy is attached/i);
  });

  it('reports a proxy that threw as an outcome rather than as an exception', async () => {
    const chat = createFakeChatService();
    await chat.createFacade(
      { stateConnectionString: 'unused' },
      { list: () => Promise.resolve([]), resolve: () => Promise.resolve(null) },
      {
        handle: () => Promise.reject(new Error('the flow gave up')),
      },
    );

    // A live chat connection never sees the proxy's exceptions, so a test that
    // could only `emit` would report "the flow threw" and "the flow answered
    // nothing" as the same failing assertion about posts().
    const outcome = await chat.deliver(mentionOn('teams', { text: 'help' }));

    expect(outcome).toEqual({
      handled: false,
      error: expect.objectContaining({ message: 'the flow gave up' }),
    });
    expect(chat.posts()).toEqual([]);
  });

  it('reports a proxy that handled the event as handled', async () => {
    const { chat } = await attached();

    const outcome = await chat.deliver(mentionOn('slack', { text: 'help' }));

    expect(outcome).toEqual({ handled: true });
  });

  it('carries a modal submission back under the correlation id it was opened with', async () => {
    const { chat, facade, received } = await attached();
    const channel = channelOn('slack');

    await facade.openModal(
      { token: 'trigger-1' },
      { title: 'Create page', fields: [] },
      'collection-1',
    );
    await chat.emit(
      modalSubmitOn('slack', {
        channel,
        correlationId: 'collection-1',
        values: { path: '/notes' },
      }),
    );

    expect(chat.modals()).toEqual([
      expect.objectContaining({ correlationId: 'collection-1' }),
    ]);
    expect(received).toEqual([
      expect.objectContaining({
        kind: 'modal-submit',
        correlationId: 'collection-1',
        values: { path: '/notes' },
      }),
    ]);
  });
});

describe('capturing what the proxy sends back', () => {
  it('records a post with the channel and the message it was given', async () => {
    const { chat, facade } = await attached();
    const channel = channelOn('discord');

    const outcome = await facade.post(channel, {
      kind: 'markdown',
      markdown: 'https://growi.example.com/created',
    });

    expect(outcome.ok).toBe(true);
    expect(chat.posts()).toEqual([
      {
        kind: 'post',
        channel,
        message: {
          kind: 'markdown',
          markdown: 'https://growi.example.com/created',
        },
      },
    ]);
  });

  it('tells an ephemeral message apart from a channel post', async () => {
    const { chat, facade } = await attached();
    const channel = channelOn('mattermost');
    const user = {
      platform: 'mattermost' as const,
      accountId: 'u1',
      displayName: 'Ada',
    };

    await facade.post(channel, { kind: 'markdown', markdown: 'everyone' });
    await facade.postEphemeral(channel, user, {
      kind: 'markdown',
      markdown: 'only you',
    });

    // Requirement 7.3's 「本人にだけ見える」 is only checkable by a harness that
    // does not flatten the two into one list of posts.
    expect(
      chat.posts().map((post) => [post.kind, post.user?.accountId]),
    ).toEqual([
      ['post', undefined],
      ['ephemeral', 'u1'],
    ]);
  });

  it('answers a post with the failure it was scripted to fail with', async () => {
    const chat = createFakeChatService({
      post: () => ({
        ok: false,
        reason: 'bot-not-in-channel',
        remedy: 'invite the bot',
      }),
    });
    const facade = await chat.createFacade(
      { stateConnectionString: 'unused' },
      { list: () => Promise.resolve([]), resolve: () => Promise.resolve(null) },
      { handle: async () => {} },
    );

    // Task 11.3 needs exactly one destination to fail while the others succeed.
    const outcome = await facade.post(channelOn('slack'), {
      kind: 'markdown',
      markdown: 'x',
    });

    expect(outcome).toEqual({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: 'invite the bot',
    });
  });
});
