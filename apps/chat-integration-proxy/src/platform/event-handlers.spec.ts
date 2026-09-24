// Task 3.8: the half of 「この層の入口」 that hands SDK events to the sink.
//
// `event-mapping.ts` already proves that each SDK event becomes the right
// `PlatformEvent`, so nothing is re-asserted here. What is asserted is what
// only this file can decide: which SDK handler each mapping is reached from,
// that the bot's own posts are dropped before any of it, and that a modal
// handle is minted from the event that can actually open one.
import type {
  ActionEvent,
  Author,
  Channel,
  Message,
  ModalSubmitEvent,
  SlashCommandEvent,
  Thread,
} from 'chat';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { PlatformEvent } from '../types/index.js';
import { type HandlerHost, registerEventHandlers } from './event-handlers.js';
import { encodeActionId } from './event-mapping.js';
import { createModalTriggerRegistry, MODAL_CALLBACK_ID } from './prompt.js';

const author = (overrides: Partial<Author> = {}): Author => ({
  userId: 'U0001',
  userName: 'alice',
  fullName: 'Alice Example',
  isBot: false,
  isMe: false,
  ...overrides,
});

const thread = (): Thread =>
  mock<Thread>({
    adapter: mock({ name: 'slack' }),
    channelId: 'C0001',
    isDM: false,
    channelVisibility: 'workspace',
    channel: mock<Channel>({ id: 'C0001', name: 'general' }),
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

interface Registered {
  mention?: (thread: Thread, message: Message) => Promise<void>;
  messagePattern?: RegExp;
  message?: (thread: Thread, message: Message) => Promise<void>;
  action?: (event: ActionEvent) => Promise<void>;
  modalCallbackId?: string;
  modalSubmit?: (event: ModalSubmitEvent) => Promise<void>;
  slashCommand?: (event: SlashCommandEvent) => Promise<void>;
}

const fakeHost = (): { host: HandlerHost; registered: Registered } => {
  const registered: Registered = {};
  return {
    registered,
    host: {
      onNewMention(handler) {
        registered.mention = handler;
      },
      onNewMessage(pattern, handler) {
        registered.messagePattern = pattern;
        registered.message = handler;
      },
      onAction(handler) {
        registered.action = handler;
      },
      onModalSubmit(callbackId, handler) {
        registered.modalCallbackId = callbackId;
        registered.modalSubmit = handler;
      },
      onSlashCommand(handler) {
        registered.slashCommand = handler;
      },
    },
  };
};

const setUp = () => {
  const handled: PlatformEvent[] = [];
  const { host, registered } = fakeHost();
  const modals = createModalTriggerRegistry();

  registerEventHandlers(host, {
    sink: {
      handle: (event) => {
        handled.push(event);
        return Promise.resolve();
      },
    },
    modals,
  });

  return { handled, registered, modals };
};

describe('messages', () => {
  it('turns a message addressed to the bot into a mention', async () => {
    const { handled, registered } = setUp();

    await registered.mention?.(thread(), message());

    expect(handled).toMatchObject([
      { kind: 'mention', text: '@growi search foo' },
    ]);
  });

  it("drops the bot's own posts before mapping them", async () => {
    // A link this bot posted would otherwise arrive back as `link-posted` and
    // make the bot preview its own preview, without end.
    const { handled, registered } = setUp();

    await registered.mention?.(
      thread(),
      message({ author: author({ isMe: true }) }),
    );
    await registered.message?.(
      thread(),
      message({
        author: author({ isMe: true }),
        isMention: false,
        text: 'see https://example.com/page',
        links: [{ url: 'https://example.com/page', title: 'Page' }],
      }),
    );

    expect(handled).toEqual([]);
  });

  it('turns an unaddressed message carrying links into link-posted', async () => {
    const { handled, registered } = setUp();

    await registered.message?.(
      thread(),
      message({
        isMention: false,
        text: 'see https://example.com/page',
        links: [{ url: 'https://example.com/page', title: 'Page' }],
      }),
    );

    expect(handled).toMatchObject([
      { kind: 'link-posted', urls: ['https://example.com/page'] },
    ]);
  });

  it('watches for links by pattern', () => {
    const { registered } = setUp();

    expect(registered.messagePattern?.test('see https://example.com')).toBe(
      true,
    );
    expect(registered.messagePattern?.test('no link here')).toBe(false);
  });

  it('does not dispatch an addressed message a second time from the link handler', async () => {
    // The SDK stops at the mention handler, so this can only happen if that
    // routing changes -- and it would answer the same command twice.
    const { handled, registered } = setUp();

    await registered.message?.(
      thread(),
      message({
        isMention: true,
        text: '@growi see https://example.com/page',
        links: [{ url: 'https://example.com/page', title: 'Page' }],
      }),
    );

    expect(handled).toEqual([]);
  });
});

describe('modal handles', () => {
  it("hands a slash command a handle that opens that very event's modal", async () => {
    // design.md: the handle is not a platform trigger id but a name for this
    // event's own `openModal()`, which is the only mechanism that works on
    // every service whose `modal` capability is `full`.
    const { handled, registered, modals } = setUp();
    const openModal = vi.fn(async () => ({ viewId: 'V1' }));

    await registered.slashCommand?.(
      mock<SlashCommandEvent>({
        adapter: mock({ name: 'slack' }),
        channel: mock<Channel>({ id: 'C0001', name: 'general' }),
        user: author(),
        command: '/growi',
        text: 'search foo',
        openModal,
      }),
    );

    const event = handled[0];
    expect(event).toMatchObject({ kind: 'slash-command', command: '/growi' });
    const interaction =
      event?.kind === 'slash-command' ? event.interaction : null;
    expect(interaction).not.toBeNull();

    // The handle names the event's own opener, so taking it out and calling it
    // must reach that event.
    await (interaction != null ? modals.take(interaction) : null)?.(mock());
    expect(openModal).toHaveBeenCalledTimes(1);
  });

  it('hands a button press the same kind of handle', async () => {
    const { handled, registered, modals } = setUp();
    const openModal = vi.fn(async () => ({ viewId: 'V1' }));

    await registered.action?.(
      mock<ActionEvent>({
        adapter: mock({ name: 'slack' }),
        actionId: encodeActionId('corr-1', 'choose'),
        value: '2',
        user: author(),
        thread: thread(),
        openModal,
      }),
    );

    const event = handled[0];
    expect(event).toMatchObject({ kind: 'action', correlationId: 'corr-1' });
    const interaction = event?.kind === 'action' ? event.interaction : null;
    await (interaction != null ? modals.take(interaction) : null)?.(mock());
    expect(openModal).toHaveBeenCalledTimes(1);
  });

  it('dispatches nothing for a button this proxy did not render', async () => {
    const { handled, registered } = setUp();

    await registered.action?.(
      mock<ActionEvent>({
        adapter: mock({ name: 'slack' }),
        actionId: 'someone-elses-button',
        user: author(),
        thread: thread(),
        openModal: async () => undefined,
      }),
    );

    expect(handled).toEqual([]);
  });
});

describe('modal submissions', () => {
  it('listens under the one callback id this proxy opens modals with', () => {
    const { registered } = setUp();

    expect(registered.modalCallbackId).toBe(MODAL_CALLBACK_ID);
  });

  it('dispatches a submission by the correlation id carried in its metadata', async () => {
    const { handled, registered } = setUp();

    await registered.modalSubmit?.(
      mock<ModalSubmitEvent>({
        adapter: mock({ name: 'slack' }),
        user: author(),
        privateMetadata: 'corr-1',
        relatedChannel: mock<Channel>({ id: 'C0001', name: 'general' }),
        // Absent, not stubbed: a submission from a modal opened over a
        // channel carries no thread, and an auto-stubbed one would be taken
        // as a real conversation.
        relatedThread: undefined,
        values: { path: '/memo' },
      }),
    );

    expect(handled).toMatchObject([
      {
        kind: 'modal-submit',
        correlationId: 'corr-1',
        values: { path: '/memo' },
      },
    ]);
  });
});
