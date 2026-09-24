import { COMMAND_NAMES, type PlatformName } from '@growi/chat';
import { describe, expect, it } from 'vitest';

import { ADMIN_CHECK_TABLE } from '../capabilities/index.js';
import type { Invocation } from '../types/index.js';
import {
  ADMIN_COMMAND_WORDS,
  type AdminActorRoles,
  isWorkspaceAdmin,
  parseAdminCommand,
} from './admin-command-set.js';
import { LINK_COMMAND_WORD } from './command-set.js';

const invocationOf = (
  commandName: string,
  argsText = '',
  platform: PlatformName = 'slack',
): Invocation => ({
  platform,
  channel: {
    platform,
    channelId: 'C1',
    channelName: 'general',
    isPrivate: false,
  },
  actor: { platform, accountId: 'U1', displayName: 'Operator' },
  commandName,
  argsText,
  interaction: null,
});

/** Someone with no admin-granting role anywhere. */
const NOBODY: AdminActorRoles = { grantedFields: [] };

/** An actor holding every admin-granting field the given service declares. */
const adminOf = (platform: PlatformName): AdminActorRoles => ({
  grantedFields: [...ADMIN_CHECK_TABLE[platform].fields],
});

const PLATFORMS = Object.keys(ADMIN_CHECK_TABLE) as ReadonlyArray<PlatformName>;

describe('isWorkspaceAdmin -- decided from the declared per-service table', () => {
  it('has every service to check (guards against a vacuous walk below)', () => {
    expect(PLATFORMS.length).toBe(4);
  });

  it.each(
    PLATFORMS,
  )('grants admin on %s for each declared field on its own', (platform) => {
    const fields = ADMIN_CHECK_TABLE[platform].fields;
    expect(fields.length).toBeGreaterThan(0);

    // Each field independently, never all at once: a check that only ever
    // looked at `fields[0]` would pass a combined assertion.
    for (const field of fields) {
      expect(isWorkspaceAdmin(platform, { grantedFields: [field] })).toBe(true);
    }
  });

  it.each(PLATFORMS)('denies an actor holding no role on %s', (platform) => {
    expect(isWorkspaceAdmin(platform, NOBODY)).toBe(false);
  });

  it.each(
    PLATFORMS,
  )('denies an actor holding only unrelated roles on %s', (platform) => {
    expect(
      isWorkspaceAdmin(platform, {
        grantedFields: ['member', 'guest', 'is_bot'],
      }),
    ).toBe(false);
  });

  it("does not accept another service's admin field", () => {
    // Slack's fields must not make a Discord actor an admin, or the table
    // would be decorative and one shared allow-list would do.
    expect(
      isWorkspaceAdmin('discord', { grantedFields: ['is_admin', 'is_owner'] }),
    ).toBe(false);
  });
});

describe('parseAdminCommand -- words that are not admin commands', () => {
  it.each([
    ...Object.values(COMMAND_NAMES),
    LINK_COMMAND_WORD,
    '',
    'nonsense',
  ])('leaves %s to the user-facing CommandSet', (word) => {
    expect(parseAdminCommand(invocationOf(word), adminOf('slack'))).toEqual({
      kind: 'not-admin-command',
    });
  });

  it('shares no word with the user-facing vocabulary', () => {
    const userWords: ReadonlyArray<string> = [
      ...Object.values(COMMAND_NAMES),
      LINK_COMMAND_WORD,
    ];
    for (const word of ADMIN_COMMAND_WORDS) {
      expect(userWords).not.toContain(word);
    }
  });
});

describe('parseAdminCommand -- only a workspace admin gets an intent', () => {
  it.each(PLATFORMS)('denies a non-admin on %s', (platform) => {
    for (const word of ADMIN_COMMAND_WORDS) {
      const outcome = parseAdminCommand(
        invocationOf(
          word,
          word === 'weight' ? 'https://growi.example 2' : '',
          platform,
        ),
        NOBODY,
      );

      expect(outcome.kind).toBe('denied');
      if (outcome.kind !== 'denied') return;
      expect(outcome.word).toBe(word);
      expect([...outcome.requiredAnyOf]).toEqual([
        ...ADMIN_CHECK_TABLE[platform].fields,
      ]);
    }
  });

  it('denies before reading the arguments', () => {
    // Argument feedback would let a non-admin probe which GROWI identifiers
    // this workspace knows, through the wording of the error alone.
    const outcome = parseAdminCommand(
      invocationOf('weight', 'not-a-number-at-all'),
      NOBODY,
    );

    expect(outcome.kind).toBe('denied');
  });
});

describe('parseAdminCommand -- register', () => {
  it('asks for a pairing code', () => {
    expect(
      parseAdminCommand(invocationOf('register'), adminOf('slack')),
    ).toEqual({
      kind: 'intent',
      intent: { operation: 'issue-pairing-code', delivery: 'ephemeral' },
    });
  });

  it('marks the pairing code for delivery only the requester can see', () => {
    const outcome = parseAdminCommand(
      invocationOf('register'),
      adminOf('slack'),
    );

    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') return;
    expect(outcome.intent.delivery).toBe('ephemeral');
  });
});

describe('parseAdminCommand -- unregister', () => {
  it('asks to undo the pairing, with no argument of its own', () => {
    expect(
      parseAdminCommand(
        invocationOf('unregister', '', 'mattermost'),
        adminOf('mattermost'),
      ),
    ).toEqual({
      kind: 'intent',
      intent: { operation: 'unregister', delivery: 'channel' },
    });
  });
});

describe('parseAdminCommand -- neither register nor unregister takes an argument', () => {
  it.each([
    ['register', 'please'],
    ['unregister', 'everything'],
  ])('rejects %s %j rather than ignoring the extra word', (word, argsText) => {
    // `unregister` undoes a pairing, so quietly discarding whatever followed
    // it is the worst of the five places to be lenient.
    const outcome = parseAdminCommand(
      invocationOf(word, argsText),
      adminOf('slack'),
    );

    expect(outcome.kind).toBe('invalid');
  });
});

describe('parseAdminCommand -- weight', () => {
  it('carries the typed GROWI token and the number, unresolved', () => {
    expect(
      parseAdminCommand(
        invocationOf('weight', 'https://growi.example  2.5'),
        adminOf('slack'),
      ),
    ).toEqual({
      kind: 'intent',
      intent: {
        operation: 'set-search-weight',
        growiRef: 'https://growi.example',
        weight: 2.5,
        delivery: 'channel',
      },
    });
  });

  it('accepts a label as the GROWI token, not only a URL', () => {
    const outcome = parseAdminCommand(
      invocationOf('weight', 'our-wiki 1'),
      adminOf('slack'),
    );

    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') return;
    expect(outcome.intent).toEqual({
      operation: 'set-search-weight',
      growiRef: 'our-wiki',
      weight: 1,
      delivery: 'channel',
    });
  });

  it.each([
    ['', 'no arguments'],
    ['https://growi.example', 'only the GROWI token'],
    ['https://growi.example 2 extra', 'a trailing extra word'],
  ])('rejects %j (%s)', (argsText) => {
    const outcome = parseAdminCommand(
      invocationOf('weight', argsText),
      adminOf('slack'),
    );

    expect(outcome.kind).toBe('invalid');
  });

  it.each([
    'foo',
    '2abc',
    'NaN',
    'Infinity',
    '-Infinity',
  ])('rejects %j as the weight rather than coercing it to a number', (value) => {
    const outcome = parseAdminCommand(
      invocationOf('weight', `https://growi.example ${value}`),
      adminOf('slack'),
    );

    expect(outcome.kind).toBe('invalid');
  });
});

describe('parseAdminCommand -- rotate-key and rotate-key status', () => {
  it('starts (or resumes) the rotation when typed on its own', () => {
    expect(
      parseAdminCommand(
        invocationOf('rotate-key', '', 'teams'),
        adminOf('teams'),
      ),
    ).toEqual({
      kind: 'intent',
      intent: { operation: 'rotate-key', delivery: 'channel' },
    });
  });

  it('asks for the progress instead when followed by "status"', () => {
    expect(
      parseAdminCommand(
        invocationOf('rotate-key', 'status', 'teams'),
        adminOf('teams'),
      ),
    ).toEqual({
      kind: 'intent',
      intent: { operation: 'rotate-key-status', delivery: 'channel' },
    });
  });

  it('produces two genuinely different operations', () => {
    const rotate = parseAdminCommand(
      invocationOf('rotate-key', '', 'teams'),
      adminOf('teams'),
    );
    const status = parseAdminCommand(
      invocationOf('rotate-key', 'status', 'teams'),
      adminOf('teams'),
    );

    expect(rotate.kind).toBe('intent');
    expect(status.kind).toBe('intent');
    if (rotate.kind !== 'intent' || status.kind !== 'intent') return;
    expect(rotate.intent.operation).not.toBe(status.intent.operation);
  });

  it('rejects an unrecognized word rather than starting a rotation', () => {
    // Falling through to the rotation would let a typo mint new keys.
    const outcome = parseAdminCommand(
      invocationOf('rotate-key', 'stauts', 'teams'),
      adminOf('teams'),
    );

    expect(outcome.kind).toBe('invalid');
  });
});

describe('parseAdminCommand -- every intent declares how it is delivered', () => {
  it.each([
    ['register', ''],
    ['unregister', ''],
    ['weight', 'https://growi.example 1'],
    ['rotate-key', ''],
    ['rotate-key', 'status'],
  ])('%s %j carries a delivery mode', (word, argsText) => {
    const outcome = parseAdminCommand(
      invocationOf(word, argsText),
      adminOf('slack'),
    );

    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') return;
    expect(['ephemeral', 'channel']).toContain(outcome.intent.delivery);
  });
});
