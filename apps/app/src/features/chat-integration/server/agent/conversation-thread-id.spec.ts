import { validate, version } from 'uuid';

import { conversationThreadIdOf } from './conversation-thread-id';

const base = {
  relationId: 'relation-1',
  userId: '64b7f0c2a1b2c3d4e5f60718',
  conversationKey: 'slack:C123:1700000000.000100',
} as const;

describe('conversationThreadIdOf', () => {
  it('returns the same id for the same relation, user and conversation key', () => {
    expect(conversationThreadIdOf({ ...base })).toBe(
      conversationThreadIdOf({ ...base }),
    );
  });

  it('returns a UUID that the GROWI AI thread routes accept', () => {
    const id = conversationThreadIdOf(base);

    expect(validate(id)).toBe(true);
    expect(version(id)).toBe(5);
  });

  it.each([
    ['relationId', { relationId: 'relation-2' }],
    ['userId', { userId: '64b7f0c2a1b2c3d4e5f60719' }],
    ['conversationKey', { conversationKey: 'slack:C123:1700000000.000200' }],
  ] as const)('returns a different id when only %s differs', (_part, change) => {
    expect(conversationThreadIdOf({ ...base, ...change })).not.toBe(
      conversationThreadIdOf(base),
    );
  });

  it('does not collide when a delimiter-like character moves between parts', () => {
    const left = conversationThreadIdOf({
      relationId: 'a:b',
      userId: 'u',
      conversationKey: 'c',
    });
    const right = conversationThreadIdOf({
      relationId: 'a',
      userId: 'u',
      conversationKey: 'b:c',
    });
    const shiftedIntoUser = conversationThreadIdOf({
      relationId: 'a',
      userId: 'b:u',
      conversationKey: 'c',
    });

    expect(new Set([left, right, shiftedIntoUser]).size).toBe(3);
  });

  it('does not collide when parts would concatenate to the same string', () => {
    expect(
      conversationThreadIdOf({
        relationId: 'ab',
        userId: 'u',
        conversationKey: 'c',
      }),
    ).not.toBe(
      conversationThreadIdOf({
        relationId: 'a',
        userId: 'bu',
        conversationKey: 'c',
      }),
    );
  });
});
