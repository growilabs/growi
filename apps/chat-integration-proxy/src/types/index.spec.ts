import { describe, expect, it } from 'vitest';

import type {
  AdminActorRoles,
  DistributedLock,
  FieldSpec,
  HistoryMessage,
  HistoryOutcome,
  InstallationCredentials,
  InteractionRef,
  Invocation,
  ModalForm,
  OutboundMessage,
  PlatformAppConfig,
  PlatformEvent,
  PlatformEventSink,
  PostOutcome,
  Relation,
  TimeRange,
} from './index.js';

// Task 1.3 declares pure cross-layer types -- there is no runtime behavior
// to assert. This file's purpose is the same as
// `packages/chat/src/contract/common.spec.ts`'s: catch a shape mistake (a
// typo'd field, a missing `readonly`, a dropped union member) by forcing
// TypeScript to accept a minimal, valid value built against each exported
// type -- imported from the barrel (`./index.js`), not re-declared inline,
// so a barrel that forgot to re-export something also fails here.

describe('types/index barrel', () => {
  it('re-exports every cross-layer type declared across types/*.ts', () => {
    // Presence-only check: the `import type` above already fails the build
    // if any of these names is missing from the barrel. This assertion
    // exists so the test file has at least one runtime expectation.
    expect(true).toBe(true);
  });
});

describe('AdminActorRoles', () => {
  it('separates "read, but holds no admin role" from "not read at all"', () => {
    // Both refuse an operator command, and the operator has to be told which
    // happened -- the empty set is their own permissions, `null` is this
    // proxy's configuration. Declared here rather than in `command/` because
    // `platform/` (which reads these facts off the chat service) sits to the
    // left of `command/` in the dependency order.
    const readButNotAdmin: AdminActorRoles = { grantedFields: [] };
    const notRead: AdminActorRoles | null = null;

    expect(readButNotAdmin.grantedFields).toEqual([]);
    expect(notRead).toBeNull();
  });
});

describe('InteractionRef / TimeRange / ModalForm / FieldSpec', () => {
  it('constructs an InteractionRef carrying only an opaque token', () => {
    const interaction: InteractionRef = { token: 'trigger-abc' };
    expect(Object.keys(interaction)).toEqual(['token']);
  });

  it('constructs a TimeRange bounding a conversation-history import', () => {
    const range: TimeRange = {
      since: new Date('2026-09-01T00:00:00Z'),
      until: new Date('2026-09-01T12:00:00Z'),
    };
    expect(range.since.getTime()).toBeLessThan(range.until.getTime());
  });

  it('constructs a FieldSpec for every declared kind', () => {
    const kinds: ReadonlyArray<FieldSpec['kind']> = [
      'text',
      'multiline',
      'path',
      'time-range',
    ];
    const specs: readonly FieldSpec[] = kinds.map((kind) => ({
      name: 'keyword',
      label: 'Keyword',
      required: true,
      kind,
    }));
    expect(specs).toHaveLength(4);
  });

  it('constructs a ModalForm from a title and an ordered FieldSpec list', () => {
    const form: ModalForm = {
      title: 'create-page',
      fields: [
        { name: 'path', label: 'Path', required: true, kind: 'path' },
        {
          name: 'body',
          label: 'Body',
          required: true,
          kind: 'multiline',
          maxLength: 10000,
        },
      ],
    };
    expect(form.fields.map((field) => field.name)).toEqual(['path', 'body']);
  });
});

describe('Relation', () => {
  it('constructs a Relation matching the `relation` table columns', () => {
    const relation: Relation = {
      relationId: 'rel_unguessable',
      installationId: 'inst_1',
      growiUri: 'https://growi.example.com',
      growiLabel: 'Engineering GROWI',
      searchWeight: 1,
      settingsVersion: 3,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    expect(relation.relationId).toBe('rel_unguessable');
  });
});

describe('Invocation', () => {
  it('normalizes a mention and a slash-command into the same shape', () => {
    const actor = {
      platform: 'slack',
      accountId: 'U1',
      displayName: 'Alice',
    } as const;
    const channel = {
      platform: 'slack',
      channelId: 'C1',
      channelName: 'general',
      isPrivate: false,
    } as const;

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
});

describe('OutboundMessage / HistoryOutcome / HistoryMessage', () => {
  it('constructs every OutboundMessage variant without any Chat SDK Card type', () => {
    const markdown: OutboundMessage = { kind: 'markdown', markdown: '**hi**' };
    const list: OutboundMessage = {
      kind: 'list',
      title: 'Search results',
      rows: [{ markdown: '- foo', sourceLabel: 'Engineering GROWI' }],
      footer: '2 more not shown',
    };
    const choice: OutboundMessage = {
      kind: 'choice',
      prompt: 'Which GROWI?',
      correlationId: 'corr_1',
      options: [{ id: 'rel_1', label: 'Engineering GROWI' }],
    };
    expect([markdown.kind, list.kind, choice.kind]).toEqual([
      'markdown',
      'list',
      'choice',
    ]);
  });

  it('constructs every PostOutcome branch', () => {
    const posted: PostOutcome = { ok: true, messageId: 'm1' };
    const notInChannel: PostOutcome = {
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: 'invite the bot to this channel',
    };
    const failed: PostOutcome = {
      ok: false,
      reason: 'platform-error',
      detail: 'socket hang up',
    };
    expect([posted.ok, notInChannel.ok, failed.ok]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('constructs both HistoryOutcome branches', () => {
    const message: HistoryMessage = {
      postedAt: '2026-09-01T00:00:00Z',
      author: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      text: 'let’s keep this',
    };
    const ok: HistoryOutcome = { ok: true, messages: [message] };
    const failed: HistoryOutcome = {
      ok: false,
      reason: 'not-in-channel',
      remedy: 'invite the bot to this channel',
    };
    expect(ok.ok && ok.messages).toEqual([message]);
    expect(!failed.ok && failed.reason).toBe('not-in-channel');
  });
});

describe('DistributedLock', () => {
  it('describes acquire/renew/release without any Chat SDK state type', () => {
    const lock: DistributedLock = {
      acquire: async () => true,
      renew: async () => true,
      release: async () => {},
    };
    expect(typeof lock.acquire).toBe('function');
  });
});

describe('PlatformEvent', () => {
  it('constructs every declared kind, and excludes `reply`', () => {
    const channel = {
      platform: 'discord',
      channelId: 'C1',
      channelName: 'general',
      isPrivate: false,
    } as const;
    const actor = {
      platform: 'discord',
      accountId: 'U1',
      displayName: 'Alice',
    } as const;

    const events: readonly PlatformEvent[] = [
      {
        kind: 'mention',
        platform: 'discord',
        channel,
        actor,
        text: 'hi',
        interaction: null,
      },
      {
        kind: 'slash-command',
        platform: 'discord',
        channel,
        actor,
        command: 'search',
        text: 'growi',
        interaction: { token: 't1' },
      },
      {
        kind: 'modal-submit',
        platform: 'discord',
        channel,
        actor,
        correlationId: 'corr1',
        values: { path: '/foo' },
      },
      {
        kind: 'action',
        platform: 'discord',
        channel,
        actor,
        correlationId: 'corr1',
        actionId: 'select-growi',
        value: 'rel_1',
        interaction: { token: 't1' },
      },
      {
        kind: 'link-posted',
        platform: 'discord',
        channel,
        actor,
        messageRef: { channel, messageId: 'M1' },
        urls: ['https://growi.example.com/foo'],
      },
    ];

    expect(events.map((event) => event.kind)).toEqual([
      'mention',
      'slash-command',
      'modal-submit',
      'action',
      'link-posted',
    ]);
    // `reply` was deliberately removed from PlatformEvent (design.md:
    // "plainReply に依存しないと決めた...`PlatformEvent` の型からも外す").
    // This is a compile-time-only check (no runtime assertion possible: at
    // runtime the type system's erasure means there's nothing to observe)
    // -- the `@ts-expect-error` below is what fails the build if `'reply'`
    // is ever re-added to `PlatformEvent['kind']`.
    // @ts-expect-error -- `'reply'` is not a member of `PlatformEvent['kind']`.
    const rejectedKind: PlatformEvent['kind'] = 'reply';
    expect(events.every((event) => event.kind !== rejectedKind)).toBe(true);
  });

  it('declares the sink a mapped event is handed to, taking any of the five kinds', async () => {
    const handled: PlatformEvent[] = [];
    const sink: PlatformEventSink = {
      handle: (event) => {
        handled.push(event);
        return Promise.resolve();
      },
    };

    await sink.handle({
      kind: 'mention',
      platform: 'discord',
      channel: {
        platform: 'discord',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      actor: { platform: 'discord', accountId: 'U1', displayName: 'Alice' },
      text: 'hi',
      interaction: null,
    });

    expect(handled.map((event) => event.kind)).toEqual(['mention']);
  });
});

describe('PlatformAppConfig / InstallationCredentials', () => {
  it('separates app-wide values from per-workspace values', () => {
    const appConfig: PlatformAppConfig = {
      slack: {
        signingSecret: 's',
        clientId: 'c',
        clientSecret: 'cs',
        appToken: 'xapp-1',
      },
      discord: {
        applicationId: 'a',
        publicKey: 'pk',
        clientSecret: 'cs',
        botToken: 'bt',
      },
      teams: { clientId: 'c', clientSecret: 'cs' },
      stateConnectionString: 'postgres://localhost/chat_sdk',
    };
    const credentials: InstallationCredentials = {
      slack: { botToken: 'xoxb-1' },
      discord: {},
      teams: { tenantId: 'tenant-1' },
      mattermost: { baseUrl: 'https://mm.example.com', botToken: 'mm-token' },
    };

    expect(appConfig.slack?.appToken).toBe('xapp-1');
    expect(credentials.slack?.botToken).toBe('xoxb-1');
    // `PlatformAppConfig` never carries a per-workspace posting token, and
    // `InstallationCredentials` never carries an always-on-connection value
    // -- enforced structurally: neither interface declares the other's
    // connection-opening fields (e.g. no `appToken` here).
  });
});
