import { describe, expect, it } from 'vitest';

import { COMMAND_NAMES } from '../commands/command-names.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import type {
  AccountLinkStartRequest,
  AccountLinkStartResponse,
} from './account-link.js';
import type { CommandRequest } from './command.js';

// Types-only file, no runtime logic of its own (same treatment as
// command.spec.ts / notification.spec.ts / pairing.spec.ts / settings.spec.ts).
// This spec is a shape probe: it proves the declared types carry what
// Requirement 7 needs, and that they are structurally their own contract,
// not folded into CommandRequest / CommandResponse.

describe('AccountLinkStartRequest', () => {
  it('carries the relation, op and the chat-side actor requesting the link (Req 7.1, 7.3)', () => {
    const request: AccountLinkStartRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.accountLinkStart,
      actor: {
        platform: 'slack',
        accountId: 'U123',
        displayName: 'Alice',
      },
    };

    expect(request.op).toBe('account-link-start');
    expect(request.actor.accountId).toBe('U123');
  });

  it('is a distinct contract from CommandRequest -- its own op, not folded into the command union', () => {
    const linkRequest: AccountLinkStartRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.accountLinkStart,
      actor: { platform: 'slack', accountId: 'U123', displayName: 'Alice' },
    };
    const commandRequest: CommandRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.command,
      requestId: 'req-1',
      actor: { platform: 'slack', accountId: 'U123', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      kind: COMMAND_NAMES.help,
    };

    // The two ops come from disjoint parts of the OP_NAMES vocabulary --
    // structurally, an AccountLinkStartRequest can never be mistaken for a
    // CommandRequest (or vice versa) by op alone.
    expect(linkRequest.op).not.toBe(commandRequest.op);

    // @ts-expect-error -- CommandRequest has no `actor`-only shape that
    // accepts AccountLinkStartRequest's op; the two request types are not
    // structurally interchangeable.
    const crossAssigned: CommandRequest = linkRequest;
    expect(crossAssigned).toBeDefined();
  });
});

describe('AccountLinkStartResponse', () => {
  it('answers with a freshly issued one-time link (Req 7.3)', () => {
    const response: AccountLinkStartResponse = {
      status: 'link-issued',
      linkUrl: 'https://growi.example.com/account-link/abc123',
      expiresAt: '2026-09-01T00:10:00.000Z',
    };
    expect(response.status).toBe('link-issued');
  });

  it('answers that the actor is already linked, naming the linked GROWI user', () => {
    const response: AccountLinkStartResponse = {
      status: 'already-linked',
      growiUserName: 'alice',
    };
    expect(response.growiUserName).toBe('alice');
  });

  it('answers that the chat account is already taken by another user within the same GROWI (Req 7.4)', () => {
    const response: AccountLinkStartResponse = {
      status: 'taken-by-another-user',
    };
    expect(response.status).toBe('taken-by-another-user');
  });

  it('does NOT share CommandResponse.kind vocabulary -- uses its own `status` discriminant', () => {
    const response: AccountLinkStartResponse = {
      status: 'taken-by-another-user',
    };

    // @ts-expect-error -- AccountLinkStartResponse has no `kind` field;
    // it is discriminated on `status`, a vocabulary of its own, distinct
    // from CommandResponse's RESPONSE_KINDS.
    expect(response.kind).toBeUndefined();
  });

  it('uses a closed status union -- an undeclared status does not typecheck', () => {
    const buildWithUnknownStatus = (): AccountLinkStartResponse => {
      const bogus: AccountLinkStartResponse = {
        // @ts-expect-error -- 'pending' was never declared in the status union
        status: 'pending',
      };
      return bogus;
    };
    expect(typeof buildWithUnknownStatus).toBe('function');
  });
});
