// Task 3.3: 「SDK のイベントを内部の表現へ変換する」.
//
// Two things are asserted here, and they are different questions:
//
//  1. **What comes out** -- the five `PlatformEvent` kinds are produced from
//     the shapes the Chat SDK really hands a handler, and an unaddressed
//     reply produces nothing at all (design.md: 「いまは呼びかけ無しの返信を
//     受け付けない」).
//  2. **What does NOT come out** -- 「SDK の型はここで止まる」. TypeScript
//     alone cannot show this: excess-property checking only fires on fresh
//     object literals, so `{ kind: 'mention', ...sdkThing }` would compile and
//     smuggle a live `Thread` / `adapter` back-reference across the boundary at
//     runtime. Every positive case therefore also asserts the produced object's
//     exact key set and that it carries no function value and no `adapter`
//     back-reference. `src/architecture.spec.ts`'s Chat SDK origin guard covers
//     the complementary half (no file outside `platform/**` may even name an SDK
//     type); neither implies the other.
import type {
  ActionEvent,
  Author,
  Channel,
  ChannelVisibility,
  LinkPreview,
  Message,
  ModalSubmitEvent,
  SlashCommandEvent,
  Thread,
} from 'chat';
import { mock } from 'vitest-mock-extended';

import type { InteractionRef, PlatformEvent } from '../types/index.js';
import {
  decodeActionId,
  encodeActionId,
  fromAction,
  fromMessage,
  fromModalSubmit,
  fromSlashCommand,
} from './event-mapping.js';

/**
 * A minted modal handle. It names the event's own `openModal()` closure (see
 * `prompt.ts`), so it is opaque here on purpose -- nothing in this file reads
 * inside it.
 */
const TRIGGER: InteractionRef = { token: 'trigger-1' };

const author = (overrides: Partial<Author> = {}): Author => ({
  userId: 'U0001',
  userName: 'alice',
  fullName: 'Alice Example',
  isBot: false,
  isMe: false,
  ...overrides,
});

const slackChannel = (name: string | null = 'general'): Channel =>
  mock<Channel>({ id: 'C0001', name });

const slackThread = (
  overrides: {
    readonly channelId?: string;
    readonly isDM?: boolean;
    readonly channelVisibility?: ChannelVisibility;
    readonly channelName?: string | null;
  } = {},
): Thread =>
  mock<Thread>({
    adapter: mock({ name: 'slack' }),
    channelId: overrides.channelId ?? 'C0001',
    isDM: overrides.isDM ?? false,
    channelVisibility: overrides.channelVisibility ?? 'workspace',
    channel: slackChannel(
      'channelName' in overrides ? (overrides.channelName ?? null) : 'general',
    ),
  });

const message = (overrides: Partial<Message> = {}): Message =>
  mock<Message>({
    id: 'M0001',
    threadId: 'slack:C0001:1.0',
    text: '@growi search foo',
    author: author(),
    links: [],
    isMention: true,
    ...overrides,
  });

const link = (url: string): LinkPreview => ({
  url,
  title: 'Some page',
  fetchMessage: async () => message(),
});

/**
 * The invariant 「SDK の型はここで止まる」, checked on a produced event: its
 * keys are exactly what `PlatformEvent` declares for that kind, and no value
 * is a function or carries an `adapter` back-reference. A spread of an SDK
 * object would break at least one of these -- the mocks used above stub every
 * method, so a leaked `Thread` / `Message` / `Channel` shows up as function
 * values.
 */
const expectNoSdkValueLeaked = (
  event: PlatformEvent,
  expectedKeys: readonly string[],
): void => {
  expect(Object.keys(event).sort()).toEqual([...expectedKeys].sort());

  const walk = (value: unknown, path: string): void => {
    expect(typeof value, `${path} must not be a function`).not.toBe('function');
    if (value == null || typeof value !== 'object') return;
    expect(
      Object.hasOwn(value, 'adapter'),
      `${path} must not carry an SDK adapter back-reference`,
    ).toBe(false);
    for (const [key, child] of Object.entries(value)) {
      walk(child, `${path}.${key}`);
    }
  };
  walk(event, 'event');
};

describe('fromMessage', () => {
  it('turns an addressed message into a mention carrying the platform, channel, speaker and text', () => {
    const event = fromMessage(
      slackThread(),
      message({ text: '@growi search foo' }),
    );

    expect(event).toEqual({
      kind: 'mention',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      text: '@growi search foo',
      // A message event never carries a modal trigger (design.md: 「mention の
      // 通知には付いてこない」).
      interaction: null,
    });
  });

  it('produces nothing for an unaddressed message, so a bare reply cannot reach the rest of the app', () => {
    // The reply exclusion, as a property of this function rather than of the
    // registration site: `PlatformEvent` has no `reply` kind, and there is no
    // other kind an unaddressed, link-free message could be forced into.
    const event = fromMessage(
      slackThread(),
      message({ isMention: false, text: '1' }),
    );

    expect(event).toBeNull();
  });

  it('turns an unaddressed message that carries URLs into link-posted, with the URLs but no command text', () => {
    const event = fromMessage(
      slackThread(),
      message({
        isMention: false,
        text: 'see https://growi.example.com/page',
        links: [link('https://growi.example.com/page')],
      }),
    );

    expect(event).toEqual({
      kind: 'link-posted',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      messageRef: {
        channel: {
          platform: 'slack',
          channelId: 'C0001',
          channelName: 'general',
          isPrivate: false,
        },
        messageId: 'M0001',
      },
      urls: ['https://growi.example.com/page'],
    });
  });

  it('keeps an addressed message that also carries URLs a mention, so its command is still read', () => {
    // Precedence matters: `link-posted` deliberately bypasses command parsing
    // (design.md: 「コマンドの解釈を通さない」), so demoting an addressed
    // message to `link-posted` would silently swallow the command.
    const event = fromMessage(
      slackThread(),
      message({
        isMention: true,
        text: '@growi keep https://growi.example.com/page',
        links: [link('https://growi.example.com/page')],
      }),
    );

    expect(event?.kind).toBe('mention');
  });

  it('marks a direct message and a private channel as private, and a workspace channel as not', () => {
    const dm = fromMessage(slackThread({ isDM: true }), message());
    const priv = fromMessage(
      slackThread({ channelVisibility: 'private' }),
      message(),
    );
    const open = fromMessage(slackThread(), message());

    expect(dm?.channel.isPrivate).toBe(true);
    expect(priv?.channel.isPrivate).toBe(true);
    expect(open?.channel.isPrivate).toBe(false);
  });

  it('still resolves the channel when the platform has not supplied a channel name yet', () => {
    // `Channel.name` is null until metadata has been fetched. The channel is
    // matched by id, never by name, so a missing name must not drop the event.
    const event = fromMessage(slackThread({ channelName: null }), message());

    expect(event?.channel.channelId).toBe('C0001');
    expect(event?.channel.channelName).toBe('');
  });

  it('falls back to the handle when the platform reports no display name', () => {
    const event = fromMessage(
      slackThread(),
      message({ author: author({ fullName: '' }) }),
    );

    expect(event?.actor.displayName).toBe('alice');
  });

  it('produces nothing for an adapter this proxy does not serve', () => {
    const foreign = mock<Thread>({
      adapter: mock({ name: 'whatsapp' }),
      channelId: 'C0001',
      isDM: false,
      channelVisibility: 'workspace',
      channel: slackChannel(),
    });

    expect(fromMessage(foreign, message())).toBeNull();
  });

  it('lets no Chat SDK value through, for either kind it produces', () => {
    const mention = fromMessage(slackThread(), message());
    const linkPosted = fromMessage(
      slackThread(),
      message({ isMention: false, links: [link('https://example.com/a')] }),
    );

    expect(mention).not.toBeNull();
    expect(linkPosted).not.toBeNull();
    if (mention == null || linkPosted == null) return;
    expectNoSdkValueLeaked(mention, [
      'kind',
      'platform',
      'channel',
      'actor',
      'text',
      'interaction',
    ]);
    expectNoSdkValueLeaked(linkPosted, [
      'kind',
      'platform',
      'channel',
      'actor',
      'messageRef',
      'urls',
    ]);
  });
});

describe('fromSlashCommand', () => {
  const slashCommandEvent = (
    overrides: Partial<SlashCommandEvent> = {},
  ): SlashCommandEvent =>
    mock<SlashCommandEvent>({
      adapter: mock({ name: 'slack' }),
      channel: mock<Channel>({
        id: 'C0001',
        name: 'general',
        isDM: false,
        channelVisibility: 'workspace',
      }),
      command: '/growi',
      text: 'search foo',
      triggerId: 'trigger-1',
      user: author(),
      ...overrides,
    });

  it('turns a slash command into a slash-command event carrying the command, its arguments and the modal handle', () => {
    const event = fromSlashCommand(slashCommandEvent(), TRIGGER);

    expect(event).toEqual({
      kind: 'slash-command',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      command: '/growi',
      text: 'search foo',
      interaction: TRIGGER,
    });
  });

  it('still delivers the command when there is no way to open a modal', () => {
    // The handle names the event's own `openModal()` closure (see
    // `prompt.ts`), so it is passed in rather than read off the event.
    // Dropping the event when there is none would make the whole command
    // unusable on a service that cannot show a modal, so the absence is
    // reported instead.
    const event = fromSlashCommand(slashCommandEvent(), null);

    expect(event?.kind).toBe('slash-command');
    expect(event).toMatchObject({ interaction: null });
  });

  it('carries the modal handle it was given even when the platform sent no trigger id', () => {
    // Teams' `modal` capability is `full` and its events never carry a
    // trigger id, so reading one off the event would make every Teams
    // invocation look modal-less. The handle names the event's own
    // `openModal()` closure instead (see `prompt.ts`).
    const event = fromSlashCommand(
      slashCommandEvent({ triggerId: undefined }),
      TRIGGER,
    );

    expect(event).toMatchObject({ interaction: TRIGGER });
  });

  it('produces nothing for an adapter this proxy does not serve', () => {
    expect(
      fromSlashCommand(
        slashCommandEvent({ adapter: mock({ name: 'whatsapp' }) }),
        TRIGGER,
      ),
    ).toBeNull();
  });

  it('lets no Chat SDK value through', () => {
    const event = fromSlashCommand(slashCommandEvent(), TRIGGER);

    expect(event).not.toBeNull();
    if (event == null) return;
    expectNoSdkValueLeaked(event, [
      'kind',
      'platform',
      'channel',
      'actor',
      'command',
      'text',
      'interaction',
    ]);
  });
});

describe('encodeActionId / decodeActionId', () => {
  it('round-trips the correlation id and the action id through the one slot a button carries', () => {
    const encoded = encodeActionId('corr-1', 'choose-growi');

    expect(decodeActionId(encoded)).toEqual({
      correlationId: 'corr-1',
      actionId: 'choose-growi',
    });
  });

  it('round-trips an action id containing the separator', () => {
    const encoded = encodeActionId('corr-1', 'choose:growi:2');

    expect(decodeActionId(encoded)).toEqual({
      correlationId: 'corr-1',
      actionId: 'choose:growi:2',
    });
  });

  it('rejects an id that this proxy did not encode, rather than inventing a correlation id', () => {
    expect(decodeActionId('choose-growi')).toBeNull();
    expect(decodeActionId('growi-action:corr-1')).toBeNull();
    expect(decodeActionId('growi-action::choose')).toBeNull();
    expect(decodeActionId('growi-action:corr-1:')).toBeNull();
  });
});

describe('fromAction', () => {
  const actionEvent = (overrides: Partial<ActionEvent> = {}): ActionEvent =>
    mock<ActionEvent>({
      actionId: encodeActionId('corr-1', 'choose-growi'),
      adapter: mock({ name: 'slack' }),
      messageId: 'M0001',
      thread: slackThread(),
      threadId: 'slack:C0001:1.0',
      triggerId: 'trigger-1',
      user: author(),
      value: 'growi-a',
      ...overrides,
    });

  it('turns a button press into an action event carrying the correlation id, the action and its value', () => {
    const event = fromAction(actionEvent(), TRIGGER);

    expect(event).toEqual({
      kind: 'action',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      correlationId: 'corr-1',
      actionId: 'choose-growi',
      value: 'growi-a',
      interaction: TRIGGER,
    });
  });

  it('reports a button carrying no payload as no value rather than as an empty string', () => {
    const event = fromAction(actionEvent({ value: undefined }), TRIGGER);

    expect(event).toMatchObject({ value: null });
  });

  it('still delivers the press when there is no way to open a modal', () => {
    const event = fromAction(actionEvent(), null);

    expect(event?.kind).toBe('action');
    expect(event).toMatchObject({ interaction: null });
  });

  it('produces nothing for a button this proxy did not encode', () => {
    // A leftover button from an older deploy: guessing a correlation id here
    // would resume someone else's collection.
    expect(
      fromAction(actionEvent({ actionId: 'approve' }), TRIGGER),
    ).toBeNull();
  });

  it('produces nothing for a press with no conversation behind it', () => {
    // Home-tab buttons arrive with `thread: null`; there is no channel to
    // answer in.
    expect(fromAction(actionEvent({ thread: null }), TRIGGER)).toBeNull();
  });

  it('lets no Chat SDK value through', () => {
    const event = fromAction(actionEvent(), TRIGGER);

    expect(event).not.toBeNull();
    if (event == null) return;
    expectNoSdkValueLeaked(event, [
      'kind',
      'platform',
      'channel',
      'actor',
      'correlationId',
      'actionId',
      'value',
      'interaction',
    ]);
  });
});

describe('fromModalSubmit', () => {
  const modalSubmitEvent = (
    overrides: Partial<ModalSubmitEvent> = {},
  ): ModalSubmitEvent =>
    mock<ModalSubmitEvent>({
      adapter: mock({ name: 'slack' }),
      callbackId: 'growi-args',
      privateMetadata: 'corr-1',
      user: author(),
      values: { path: '/Sandbox', comment: 'hello' },
      viewId: 'V0001',
      relatedThread: slackThread(),
      ...overrides,
    });

  it('turns a modal submission into a modal-submit event carrying the correlation id and the collected values', () => {
    const event = fromModalSubmit(modalSubmitEvent());

    expect(event).toEqual({
      kind: 'modal-submit',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      correlationId: 'corr-1',
      values: { path: '/Sandbox', comment: 'hello' },
    });
  });

  it('copies the collected values instead of handing over the SDK payload object', () => {
    const values = { path: '/Sandbox' };
    const event = fromModalSubmit(modalSubmitEvent({ values }));

    expect(event).toMatchObject({ values: { path: '/Sandbox' } });
    expect(event?.kind === 'modal-submit' && event.values).not.toBe(values);
  });

  it('resolves the channel from the channel the modal was opened from when there is no thread', () => {
    const event = fromModalSubmit(
      modalSubmitEvent({
        relatedThread: undefined,
        relatedChannel: mock<Channel>({
          id: 'C0002',
          name: 'random',
          isDM: false,
          channelVisibility: 'private',
        }),
      }),
    );

    expect(event?.channel).toEqual({
      platform: 'slack',
      channelId: 'C0002',
      channelName: 'random',
      isPrivate: true,
    });
  });

  it('produces nothing for a submission that carries no correlation id', () => {
    expect(
      fromModalSubmit(modalSubmitEvent({ privateMetadata: undefined })),
    ).toBeNull();
    expect(
      fromModalSubmit(modalSubmitEvent({ privateMetadata: '' })),
    ).toBeNull();
  });

  it('produces nothing for a submission with no conversation behind it', () => {
    expect(
      fromModalSubmit(
        modalSubmitEvent({
          relatedThread: undefined,
          relatedChannel: undefined,
        }),
      ),
    ).toBeNull();
  });

  it('lets no Chat SDK value through', () => {
    const event = fromModalSubmit(modalSubmitEvent());

    expect(event).not.toBeNull();
    if (event == null) return;
    expectNoSdkValueLeaked(event, [
      'kind',
      'platform',
      'channel',
      'actor',
      'correlationId',
      'values',
    ]);
  });
});
