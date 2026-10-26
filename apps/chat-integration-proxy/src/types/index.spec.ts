import { describe, expect, it } from 'vitest';

import type {
  AdminActorRoles,
  DirectPostOutcome,
  DistributedLock,
  EphemeralPostOutcome,
  FieldSpec,
  HistoryMessage,
  HistoryOutcome,
  InstallationCredentials,
  InteractionRef,
  Invocation,
  ModalForm,
  OutboundMessage,
  PlatformAppConfig,
  PostOutcome,
  ReactionName,
  ReactionOutcome,
  Relation,
  SdkChannelRef,
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

describe('private-reply outcome types', () => {
  it('lets only the ephemeral outcome answer unsupported, keeping PostOutcome unchanged', () => {
    const unsupported: EphemeralPostOutcome = {
      ok: false,
      reason: 'unsupported',
    };
    const posted: EphemeralPostOutcome = { ok: true, messageId: 'm1' };
    // @ts-expect-error PostOutcome must not gain the unsupported arm.
    const notAPostOutcome: PostOutcome = unsupported;

    expect([unsupported, posted, notAPostOutcome]).toHaveLength(3);
  });

  it('carries the DM channel on a successful direct post', () => {
    const channel: SdkChannelRef = {
      platform: 'slack',
      channelId: 'slack:D1' as SdkChannelRef['channelId'],
      channelName: 'dm',
      isPrivate: true,
    };
    const ok: DirectPostOutcome = { ok: true, messageId: 'm1', channel };
    const failed: DirectPostOutcome = { ok: false, detail: 'im:write missing' };
    const reacted: ReactionOutcome = { ok: true };
    const reactionFailed: ReactionOutcome = { ok: false, detail: 'nope' };
    const names: ReactionName[] = ['eyes', 'email'];

    expect([ok, failed, reacted, reactionFailed, names]).toHaveLength(5);
  });
});

describe('Invocation.sourceMessageId', () => {
  it('is optional so a stored row without it still type-checks', () => {
    const base: Invocation = {
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'slack:C1' as SdkChannelRef['channelId'],
        channelName: 'general',
        isPrivate: false,
      },
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      commandName: 'search',
      argsText: '',
      interaction: null,
    };
    const withId: Invocation = { ...base, sourceMessageId: '1700.1' };
    const withNull: Invocation = { ...base, sourceMessageId: null };

    expect([base, withId, withNull]).toHaveLength(3);
  });
});
