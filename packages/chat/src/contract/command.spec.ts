import { describe, expect, it } from 'vitest';

import { COMMAND_NAMES } from '../commands/command-names.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import type {
  CommandEnvelope,
  CommandRequest,
  CommandResponse,
  KeepMessage,
  ResponseKind,
  SearchResultItem,
} from './command.js';
import { RESPONSE_KINDS } from './command.js';

// This spec has no runtime behavior to assert (task 3.1 declares pure
// types). Its purpose is to catch shape mistakes and, most importantly, to
// prove -- structurally, at compile time -- that `CommandRequest.kind`
// cannot be spelled outside `COMMAND_NAMES`. If a field is renamed, a union
// member dropped, or the vocabulary link severed, this file fails to
// compile and the test run reports it.

describe('CommandEnvelope', () => {
  it('extends RequestEnvelope with the fields every command carries (Requirement 3.6, 3.7)', () => {
    const envelope: CommandEnvelope = {
      relationId: 'rel-1',
      op: OP_NAMES.command,
      requestId: 'req-1',
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
    };
    expect(Object.keys(envelope).sort()).toEqual(
      ['actor', 'channel', 'op', 'relationId', 'requestId'].sort(),
    );
  });
});

describe('CommandRequest', () => {
  it('builds a search request whose kind is COMMAND_NAMES.search (Requirement 3.9)', () => {
    const request: CommandRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.command,
      requestId: 'req-1',
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      kind: COMMAND_NAMES.search,
      keyword: 'onboarding',
      limit: 10,
    };
    expect(request.kind).toBe('search');
  });

  it('builds a create-page request carrying path and body (Requirement 4.2, 4.3)', () => {
    const request: CommandRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.command,
      requestId: 'req-1',
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      kind: COMMAND_NAMES.createPage,
      path: '/team/notes',
      body: '# Notes',
    };
    expect(request.kind).toBe('create-page');
  });

  it('builds a keep request whose messages keep the chat-side speaker (Requirement 5.2, 5.3)', () => {
    const message: KeepMessage = {
      postedAt: '2026-09-01T00:00:00.000Z',
      author: { platform: 'slack', accountId: 'U2', displayName: 'Bob' },
      markdown: 'hello',
    };
    const request: CommandRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.command,
      requestId: 'req-1',
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      kind: COMMAND_NAMES.keep,
      path: '/team/thread',
      messages: [message],
    };
    expect(request.messages[0]).toEqual(message);
  });

  it('builds a link-preview request carrying the posted URL (Requirement 6.2, 6.3)', () => {
    const request: CommandRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.command,
      requestId: 'req-1',
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      kind: COMMAND_NAMES.linkPreview,
      pageUrl: 'https://growi.example.com/team/notes',
    };
    expect(request.kind).toBe('link-preview');
  });

  it('builds a help request with no command-specific fields (Requirement 14.2)', () => {
    const request: CommandRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.command,
      requestId: 'req-1',
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      kind: COMMAND_NAMES.help,
    };
    expect(request.kind).toBe('help');
  });

  it('cannot assign a kind outside COMMAND_NAMES (structural proof, Requirement 3.9 vocabulary link)', () => {
    // This block is a type-level probe, not a runtime assertion: assigning a
    // bogus `kind` string must fail to typecheck against `CommandRequest`.
    // Verified during RED by temporarily removing the `@ts-expect-error`
    // comment: tsgo rejected the assignment with TS2322 (the literal
    // 'not-a-real-command' is not one of the five COMMAND_NAMES values) --
    // see the task's RED_PHASE_OUTPUT for the captured message.
    const buildWithUnknownKind = (): CommandRequest => {
      const bogus: CommandRequest = {
        relationId: 'rel-1',
        op: OP_NAMES.command,
        requestId: 'req-1',
        actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
        channel: {
          platform: 'slack',
          channelId: 'C1',
          channelName: 'general',
          isPrivate: false,
        },
        // @ts-expect-error -- 'not-a-real-command' is not a COMMAND_NAMES value
        kind: 'not-a-real-command',
      };
      return bogus;
    };
    expect(typeof buildWithUnknownKind).toBe('function');
  });
});

describe('SearchResultItem', () => {
  it('carries structured fields, not a pre-rendered display string (Requirement 3.9)', () => {
    const item: SearchResultItem = {
      rank: 1,
      path: '/team/notes',
      title: 'Notes',
      url: 'https://growi.example.com/team/notes',
      updatedAt: '2026-09-01T00:00:00.000Z',
      commentCount: 3,
    };
    expect(Object.keys(item).sort()).toEqual(
      ['commentCount', 'path', 'rank', 'title', 'updatedAt', 'url'].sort(),
    );
  });
});

describe('RESPONSE_KINDS / ResponseKind', () => {
  it('names every response kind as a constant (same treatment as COMMAND_NAMES)', () => {
    expect(RESPONSE_KINDS).toEqual({
      search: 'search',
      created: 'created',
      linkPreview: 'link-preview',
      help: 'help',
      accountLinkRequired: 'account-link-required',
      error: 'error',
    });
  });

  it('accepts every ResponseKind literal', () => {
    const kinds: readonly ResponseKind[] = Object.values(RESPONSE_KINDS);
    expect(kinds).toHaveLength(6);
  });
});

describe('CommandResponse', () => {
  it('builds a search response carrying structured items and how permission was applied (Requirement 3.6, 3.9)', () => {
    const response: CommandResponse = {
      kind: RESPONSE_KINDS.search,
      items: [
        {
          rank: 1,
          path: '/team/notes',
          title: 'Notes',
          url: 'https://growi.example.com/team/notes',
          updatedAt: '2026-09-01T00:00:00.000Z',
          commentCount: 0,
        },
      ],
      appliedAs: 'anonymous',
    };
    expect(response.kind).toBe('search');
  });

  it('builds a created response shared by create-page and keep (Requirement 4.2, 5.2)', () => {
    const response: CommandResponse = {
      kind: RESPONSE_KINDS.created,
      pageUrl: 'https://growi.example.com/team/notes',
      importedMessageCount: 5,
    };
    expect(response.kind).toBe('created');
  });

  it('builds a created response with importedMessageCount omitted for create-page (Requirement 4.2)', () => {
    const response: CommandResponse = {
      kind: RESPONSE_KINDS.created,
      pageUrl: 'https://growi.example.com/team/notes',
    };
    expect(response.importedMessageCount).toBeUndefined();
  });

  it('builds a link-preview response that omits detail fields for a restricted page (Requirement 6.2, 6.3)', () => {
    const restricted: CommandResponse = {
      kind: RESPONSE_KINDS.linkPreview,
      path: '/team/private-notes',
      restricted: true,
    };
    expect(restricted.excerpt).toBeUndefined();
    expect(restricted.updatedAt).toBeUndefined();
    expect(restricted.commentCount).toBeUndefined();

    const open: CommandResponse = {
      kind: RESPONSE_KINDS.linkPreview,
      path: '/team/notes',
      restricted: false,
      excerpt: 'Introduction...',
      updatedAt: '2026-09-01T00:00:00.000Z',
      commentCount: 2,
    };
    expect(open.restricted).toBe(false);
  });

  it('builds a help response whose command names come from CommandName (Requirement 14.2)', () => {
    const response: CommandResponse = {
      kind: RESPONSE_KINDS.help,
      commands: [
        {
          name: COMMAND_NAMES.search,
          usage: '/growi search <keyword>',
          description: 'Search across linked GROWI instances',
        },
      ],
    };
    expect(response.commands[0]?.name).toBe(COMMAND_NAMES.search);
  });

  it('builds an account-link-required response naming which GROWI and where to go (Requirement 4.4, 7.6)', () => {
    const response: CommandResponse = {
      kind: RESPONSE_KINDS.accountLinkRequired,
      growiLabel: 'Team Wiki',
      linkUrl: 'https://growi.example.com/chat-integration/account-link/start',
    };
    expect(response.growiLabel).toBe('Team Wiki');
    expect(response.linkUrl).toContain('account-link');
  });

  it('builds an error response using one of the declared error codes (Requirement 4.5, 4.6)', () => {
    const forbidden: CommandResponse = {
      kind: RESPONSE_KINDS.error,
      code: 'forbidden',
      message: 'You do not have permission to create a page at this path.',
    };
    expect(forbidden.code).toBe('forbidden');

    const pathConflict: CommandResponse = {
      kind: RESPONSE_KINDS.error,
      code: 'path-conflict',
      message: 'A page already exists at this path.',
    };
    expect(pathConflict.code).toBe('path-conflict');
  });
});
