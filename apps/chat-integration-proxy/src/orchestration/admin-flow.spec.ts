// What these tests hold down is the half of `AdminCommandSet` that task 4.3
// deliberately left unbuilt: it turns an operator's words into an
// `AdminCommandIntent` and stops there, so THIS is where the intent is
// actually carried out.
//
// Three properties are the reason the tests are shaped the way they are:
//
//  1. **The registration code never reaches the channel.** `issue-pairing-code`
//     pins `delivery: 'ephemeral'` in its own type, and the assertion here is
//     that `post` is not called at all -- not merely that `postEphemeral` was.
//  2. **Nothing is carried out before the actor's roles have been judged.**
//     A denied or unobservable actor must leave every service untouched.
//  3. **`rotate-key` composes `RelationKeyService` with `GrowiClient`.** The
//     function handed to `rotate` is captured and called, because "it was
//     passed something" is satisfied by any function at all.
import type { KeyOperationResult, PlatformName } from '@growi/chat';
import { type MockProxy, mock, mockDeep } from 'vitest-mock-extended';

import type { AdminActorRoles } from '../command/index.js';
import type { PrismaClient } from '../db/index.js';
import { PairingOrderLimitError } from '../relation/index.js';
import type { Invocation, OutboundMessage } from '../types/index.js';
import {
  type AdminFlowDeps,
  type AdminFlowPlatform,
  createAdminFlow,
} from './admin-flow.js';

const PLATFORM: PlatformName = 'slack';
const INSTALLATION_ID = 'installation-1';

const channel = {
  platform: PLATFORM,
  channelId: 'C1',
  channelName: 'general',
  isPrivate: false,
};
const actor = { platform: PLATFORM, accountId: 'U1', displayName: 'Taro' };

const ADMIN: AdminActorRoles = { grantedFields: ['is_admin'] };
const NOT_ADMIN: AdminActorRoles = { grantedFields: [] };

const invocationOf = (commandName: string, argsText = ''): Invocation => ({
  platform: PLATFORM,
  channel,
  actor,
  commandName,
  argsText,
  interaction: null,
});

const relationRow = (id: string, growiLabel: string) => ({
  id,
  installationId: INSTALLATION_ID,
  growiUri: `https://${id}.example.com/`,
  growiLabel,
  searchWeight: 1,
  settingsVersion: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

interface Harness {
  readonly flow: ReturnType<typeof createAdminFlow>;
  readonly prisma: ReturnType<typeof mockDeep<PrismaClient>>;
  readonly platform: MockProxy<AdminFlowPlatform>;
  readonly pairing: MockProxy<AdminFlowDeps['pairing']>;
  readonly keyService: MockProxy<AdminFlowDeps['keyService']>;
  readonly growiClient: MockProxy<AdminFlowDeps['growiClient']>;
  readonly ephemeral: () => ReadonlyArray<OutboundMessage>;
  readonly posted: () => ReadonlyArray<OutboundMessage>;
  readonly saidText: () => string;
}

const createHarness = (
  roles: AdminActorRoles | null = ADMIN,
  relations: ReadonlyArray<ReturnType<typeof relationRow>> = [
    relationRow('rel-a', 'growi-a'),
  ],
): Harness => {
  const prisma = mockDeep<PrismaClient>();
  prisma.relation.findMany.mockResolvedValue([...relations]);
  prisma.relation.update.mockResolvedValue(relationRow('rel-a', 'growi-a'));

  const platform = mock<AdminFlowPlatform>();
  platform.post.mockResolvedValue({ ok: true, messageId: 'M1' });
  platform.postEphemeral.mockResolvedValue({ ok: true, messageId: 'M2' });

  const pairing = mock<AdminFlowDeps['pairing']>();
  pairing.issueCode.mockResolvedValue({
    code: 'CODE-XYZ',
    expiresAt: new Date('2026-06-01T00:15:00.000Z'),
  });
  pairing.unpair.mockResolvedValue();

  const keyService = mock<AdminFlowDeps['keyService']>();
  keyService.rotate.mockResolvedValue([]);
  keyService.rotationStatus.mockResolvedValue([]);
  keyService.revokeOldIfAllDelivered.mockResolvedValue(false);

  const growiClient = mock<AdminFlowDeps['growiClient']>();

  const flow = createAdminFlow({
    db: prisma,
    platform,
    pairing,
    keyService,
    growiClient,
    resolveInstallationId: () => Promise.resolve(INSTALLATION_ID),
    observeActorRoles: () => Promise.resolve(roles),
  });

  const ephemeral = () =>
    platform.postEphemeral.mock.calls.map((call) => call[2]);
  const posted = () => platform.post.mock.calls.map((call) => call[1]);

  return {
    flow,
    prisma,
    platform,
    pairing,
    keyService,
    growiClient,
    ephemeral,
    posted,
    saidText: () =>
      [...ephemeral(), ...posted()]
        .map((message) =>
          message.kind === 'markdown' ? message.markdown : message.kind,
        )
        .join('\n'),
  };
};

describe('the admin gate', () => {
  it('carries out nothing at all for an actor who is not a workspace admin', async () => {
    const harness = createHarness(NOT_ADMIN);

    await harness.flow.run(invocationOf('register'));

    expect(harness.pairing.issueCode).not.toHaveBeenCalled();
    expect(harness.platform.post).not.toHaveBeenCalled();
    expect(harness.ephemeral()).toHaveLength(1);
  });

  it('refuses when the actor s roles could not be observed at all', async () => {
    // A missing answer is not an empty one: `PlatformFacade` has no
    // role-query method, so the observation is injected and may fail. Reading
    // that as "no roles" would be the same as reading it as "not an admin",
    // which is the safe direction -- but the operator has to be told why.
    const harness = createHarness(null);

    await harness.flow.run(invocationOf('register'));

    expect(harness.pairing.issueCode).not.toHaveBeenCalled();
    expect(harness.ephemeral()).toHaveLength(1);
  });

  it('answers a mistyped operator line without carrying anything out', async () => {
    const harness = createHarness();

    await harness.flow.run(invocationOf('rotate-key', 'stauts'));

    expect(harness.keyService.rotate).not.toHaveBeenCalled();
    expect(harness.keyService.revokeOldIfAllDelivered).not.toHaveBeenCalled();
    expect(harness.posted()).toHaveLength(0);
    expect(harness.ephemeral()).toHaveLength(1);
  });
});

describe('register (Requirement 9.1)', () => {
  it('issues a code for the installation the command was typed in, and shows it only to the person who asked', async () => {
    const harness = createHarness();

    await harness.flow.run(invocationOf('register'));

    expect(harness.pairing.issueCode).toHaveBeenCalledWith(
      INSTALLATION_ID,
      actor,
    );
    // The code must never sit in a channel: it is what pairs a GROWI, and
    // anyone who reads it can use it.
    expect(harness.platform.post).not.toHaveBeenCalled();
    expect(harness.saidText()).toContain('CODE-XYZ');
  });

  it('reports the per-installation limit without leaking a code', async () => {
    const harness = createHarness();
    harness.pairing.issueCode.mockRejectedValue(
      new PairingOrderLimitError(INSTALLATION_ID),
    );

    await harness.flow.run(invocationOf('register'));

    expect(harness.platform.post).not.toHaveBeenCalled();
    expect(harness.ephemeral()).toHaveLength(1);
    expect(harness.saidText()).not.toContain('CODE-XYZ');
  });
});

describe('unregister (Requirement 9.7)', () => {
  it('unpairs the one GROWI of this workspace', async () => {
    const harness = createHarness(ADMIN, [relationRow('rel-a', 'growi-a')]);

    await harness.flow.run(invocationOf('unregister'));

    expect(harness.pairing.unpair).toHaveBeenCalledWith('rel-a');
  });

  it('refuses when the workspace has several GROWIs, and names them', async () => {
    // `AdminCommandIntent`'s `unregister` carries no GROWI to act on, so with
    // more than one paired there is nothing that says which. Picking one would
    // be the most destructive guess of the five commands.
    const harness = createHarness(ADMIN, [
      relationRow('rel-a', 'growi-a'),
      relationRow('rel-b', 'growi-b'),
    ]);

    await harness.flow.run(invocationOf('unregister'));

    expect(harness.pairing.unpair).not.toHaveBeenCalled();
    expect(harness.saidText()).toContain('growi-a');
    expect(harness.saidText()).toContain('growi-b');
  });

  it('says there is nothing to undo when no GROWI is paired', async () => {
    const harness = createHarness(ADMIN, []);

    await harness.flow.run(invocationOf('unregister'));

    expect(harness.pairing.unpair).not.toHaveBeenCalled();
    expect(harness.saidText().length).toBeGreaterThan(0);
  });
});

describe('weight (Requirement 3.8)', () => {
  it('writes the weight of the GROWI named by its label', async () => {
    const harness = createHarness(ADMIN, [
      relationRow('rel-a', 'growi-a'),
      relationRow('rel-b', 'growi-b'),
    ]);

    await harness.flow.run(invocationOf('weight', 'growi-b 4'));

    expect(harness.prisma.relation.update).toHaveBeenCalledWith({
      where: { id: 'rel-b' },
      data: { searchWeight: 4 },
    });
  });

  it('accepts the GROWI s URI as the name too', async () => {
    const harness = createHarness(ADMIN, [relationRow('rel-a', 'growi-a')]);

    await harness.flow.run(
      invocationOf('weight', 'https://rel-a.example.com/ 3'),
    );

    expect(harness.prisma.relation.update).toHaveBeenCalledWith({
      where: { id: 'rel-a' },
      data: { searchWeight: 3 },
    });
  });

  it('writes nothing when the name matches no paired GROWI', async () => {
    const harness = createHarness(ADMIN, [relationRow('rel-a', 'growi-a')]);

    await harness.flow.run(invocationOf('weight', 'growi-z 3'));

    expect(harness.prisma.relation.update).not.toHaveBeenCalled();
    expect(harness.saidText().length).toBeGreaterThan(0);
  });

  it.each([
    ['0', 'a weight of zero silently drops the GROWI from every result'],
    ['-1', 'a negative weight has no meaning in the fusion formula'],
    ['1.5', 'search_weight is an integer column'],
    ['99999', 'one GROWI must not be able to swamp the others'],
  ])('refuses the weight %s: %s', async (token) => {
    // `AdminCommandSet` deliberately checks only that the token is a finite
    // number and leaves the range to whoever writes the column -- that is
    // here (task 4.3's hand-off).
    const harness = createHarness(ADMIN, [relationRow('rel-a', 'growi-a')]);

    await harness.flow.run(invocationOf('weight', `growi-a ${token}`));

    expect(harness.prisma.relation.update).not.toHaveBeenCalled();
    expect(harness.saidText().length).toBeGreaterThan(0);
  });
});

describe('rotate-key (Requirement 10.5)', () => {
  it('starts the rotation and hands it the real way to reach a GROWI', async () => {
    // `RelationKeyService` cannot import `GrowiClient` (`relation/` is to the
    // LEFT of `growi/`), so composing the two is this layer's job. Capturing
    // the function and calling it is the only way to tell "the right function
    // was handed over" from "some function was handed over".
    const harness = createHarness();
    const answer: KeyOperationResult = { status: 'ok' };
    harness.growiClient.registerKey.mockResolvedValue({
      ok: true,
      response: answer,
    });

    await harness.flow.run(invocationOf('rotate-key'));

    expect(harness.keyService.rotate).toHaveBeenCalledWith(
      INSTALLATION_ID,
      expect.any(Function),
    );
    const send = harness.keyService.rotate.mock.calls[0][1];
    const request = {
      relationId: 'rel-a',
      op: 'key-register-to-growi',
      key: {
        keyId: 'k1',
        publicKeyJwk: {},
        validFrom: '2026-06-01T00:00:00.000Z',
      },
    } as const;
    await expect(send('https://rel-a.example.com/', request)).resolves.toEqual({
      ok: true,
      response: answer,
    });
    expect(harness.growiClient.registerKey).toHaveBeenCalledWith(
      'https://rel-a.example.com/',
      request,
    );
  });

  it('does not revoke anything -- that is the separate fourth step', async () => {
    const harness = createHarness();

    await harness.flow.run(invocationOf('rotate-key'));

    expect(harness.keyService.revokeOldIfAllDelivered).not.toHaveBeenCalled();
  });

  it('names the GROWIs a new key did not reach', async () => {
    const harness = createHarness(ADMIN, [
      relationRow('rel-a', 'growi-a'),
      relationRow('rel-b', 'growi-b'),
    ]);
    harness.keyService.rotate.mockResolvedValue([
      { relationId: 'rel-a', newKeyId: 'k1', delivery: { ok: true } },
      {
        relationId: 'rel-b',
        newKeyId: 'k2',
        delivery: { ok: false, reason: 'unreachable' },
      },
    ]);

    await harness.flow.run(invocationOf('rotate-key'));

    expect(harness.saidText()).toContain('growi-b');
  });
});

describe('rotate-key status (Requirement 10.5, step 4)', () => {
  it('reads the state of play before revoking, so what it shows is not the state it just created', async () => {
    const harness = createHarness();
    const order: string[] = [];
    harness.keyService.rotationStatus.mockImplementation(() => {
      order.push('status');
      return Promise.resolve([
        {
          relationId: 'rel-a',
          growiLabel: 'growi-a',
          newKeyId: 'k1',
          deliveredToPeer: false,
          problem: null,
        },
      ]);
    });
    harness.keyService.revokeOldIfAllDelivered.mockImplementation(() => {
      order.push('revoke');
      return Promise.resolve(false);
    });

    await harness.flow.run(invocationOf('rotate-key', 'status'));

    expect(order).toEqual(['status', 'revoke']);
    expect(harness.saidText()).toContain('growi-a');
  });

  it('runs the fourth step through the real way to reach a GROWI', async () => {
    const harness = createHarness();
    const answer: KeyOperationResult = { status: 'ok' };
    harness.growiClient.revokeKey.mockResolvedValue({
      ok: true,
      response: answer,
    });

    await harness.flow.run(invocationOf('rotate-key', 'status'));

    expect(harness.keyService.revokeOldIfAllDelivered).toHaveBeenCalledWith(
      INSTALLATION_ID,
      expect.any(Function),
    );
    const send = harness.keyService.revokeOldIfAllDelivered.mock.calls[0][1];
    const request = {
      relationId: 'rel-a',
      op: 'key-revoke-to-growi',
      keyId: 'k-old',
    } as const;
    await expect(send('https://rel-a.example.com/', request)).resolves.toEqual({
      ok: true,
      response: answer,
    });
    expect(harness.growiClient.revokeKey).toHaveBeenCalledWith(
      'https://rel-a.example.com/',
      request,
    );
  });

  it('says the old keys were retired once every GROWI has the new one', async () => {
    const harness = createHarness();
    harness.keyService.rotationStatus.mockResolvedValue([
      {
        relationId: 'rel-a',
        growiLabel: 'growi-a',
        newKeyId: 'k1',
        deliveredToPeer: true,
        problem: null,
      },
    ]);
    harness.keyService.revokeOldIfAllDelivered.mockResolvedValue(true);

    await harness.flow.run(invocationOf('rotate-key', 'status'));

    expect(harness.saidText().length).toBeGreaterThan(0);
  });
});
