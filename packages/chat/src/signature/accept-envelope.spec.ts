import { describe, expect, it } from 'vitest';

import type { CommandEnvelope } from '../contract/command.js';
import type { NotificationRequest } from '../contract/notification.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import { acceptEnvelope } from './accept-envelope.js';
import type { KeyRef } from './key-identity.js';

const verified: KeyRef = {
  relationId: 'relation-abcdef12',
  keyId: 'key-abcdef12',
};

const commandBody = (
  overrides: Partial<CommandEnvelope> = {},
): CommandEnvelope => ({
  relationId: verified.relationId,
  op: OP_NAMES.command,
  requestId: 'req-1',
  actor: {
    platform: 'slack',
    accountId: 'U123',
    displayName: 'someone',
  },
  channel: {
    platform: 'slack',
    channelId: 'C123',
    channelName: 'general',
    isPrivate: false,
  },
  ...overrides,
});

const notificationBody = (
  overrides: Partial<NotificationRequest> = {},
): NotificationRequest => ({
  relationId: verified.relationId,
  op: OP_NAMES.notification,
  requestId: 'req-2',
  targets: [{ platform: 'slack', channelId: 'C123' }],
  markdown: 'hello',
  containsRestrictedPage: false,
  ...overrides,
});

describe('acceptEnvelope', () => {
  it('accepts a body whose relationId and op both agree, returning the very same object', () => {
    const body = commandBody();
    const result = acceptEnvelope(body, verified, OP_NAMES.command);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('unreachable');
    }
    // The body must be handed back untouched -- callers use the returned
    // value, and silently copying or transforming it would let the two
    // diverge.
    expect(result.body).toBe(body);
  });

  it('rejects a body claiming a relation other than the one the signature proved (Requirement 10.1)', () => {
    // A request validly signed with relation A's key, whose body claims
    // relation B. Without this check, anything downstream that trusts the
    // body would act on B's behalf although B's key authorized nothing.
    const body = commandBody({ relationId: 'relation-99999999' });

    expect(acceptEnvelope(body, verified, OP_NAMES.command)).toEqual({
      ok: false,
      failure: 'malformed',
    });
  });

  it('rejects a body whose op is not the op of the endpoint that received it (Requirement 10.1)', () => {
    // The signature covers `op` but knows nothing about which endpoint the
    // bytes physically reached -- neither the target URL nor the path is
    // covered. Only the receiving side knows that, so re-using a signature on
    // a different endpoint is closed here and nowhere else.
    const body = notificationBody();

    expect(acceptEnvelope(body, verified, OP_NAMES.settingsPush)).toEqual({
      ok: false,
      failure: 'malformed',
    });
  });

  it('rejects a body whose op is the same operation in the opposite direction', () => {
    // The reason `OP_NAMES` spells the direction into the name: a key
    // registration signed for the proxy's endpoint must not be accepted at
    // GROWI's endpoint, and vice versa.
    const body = {
      relationId: verified.relationId,
      op: OP_NAMES.keyRegisterToProxy,
    };

    expect(acceptEnvelope(body, verified, OP_NAMES.keyRegisterToGrowi)).toEqual(
      { ok: false, failure: 'malformed' },
    );
  });

  it('rejects a body when both the relationId and the op disagree', () => {
    const body = commandBody({ relationId: 'relation-99999999' });

    expect(acceptEnvelope(body, verified, OP_NAMES.settingsPull)).toEqual({
      ok: false,
      failure: 'malformed',
    });
  });

  it('is usable with any RequestEnvelope-extending body without a cast', () => {
    const command = acceptEnvelope(commandBody(), verified, OP_NAMES.command);
    const notification = acceptEnvelope(
      notificationBody(),
      verified,
      OP_NAMES.notification,
    );

    expect(command.ok).toBe(true);
    expect(notification.ok).toBe(true);
    if (command.ok) {
      // The concrete type survives the call: no widening to RequestEnvelope.
      expect(command.body.requestId).toBe('req-1');
    }
    if (notification.ok) {
      expect(notification.body.markdown).toBe('hello');
    }
  });

  it('does not accept a body that lacks relationId / op', () => {
    // Type-level probe. `pnpm vitest run` does not typecheck, so the
    // evidence for this one is `pnpm lint` (tsgo --noEmit).
    // @ts-expect-error a body without `relationId` and `op` is not an envelope
    acceptEnvelope({ requestId: 'req-1' }, verified, OP_NAMES.command);
    acceptEnvelope(
      // @ts-expect-error `op` must be a declared op name, not an arbitrary string
      { relationId: verified.relationId, op: 'not-an-op' },
      verified,
      OP_NAMES.command,
    );
  });
});
