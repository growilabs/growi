import type { commentreactions } from '~/generated/prisma/client';

import type { ReactionUserRow, ReactionUserSummary } from '../../interfaces';
import { summarizeReactions } from './summarize-reactions';

const oid = (n: number): string => n.toString(16).padStart(24, '0');

const row = (
  commentId: string,
  userId: string,
  emoji: string,
  minute: number,
): commentreactions => ({
  id: oid(1000 + minute),
  v: 0,
  commentId,
  pageId: oid(9),
  userId,
  emoji,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
});

const userRow = (id: string, name: string): ReactionUserRow => ({
  id,
  _id: id,
  username: `${name}-username`,
  name,
  imageUrlCached: `/img/${name}`,
});

const usersById = new Map<string, ReactionUserRow>([
  [oid(1), userRow(oid(1), 'alice')],
  [oid(2), userRow(oid(2), 'bob')],
  [oid(3), userRow(oid(3), 'carol')],
]);

const formatUser = (user: ReactionUserRow): ReactionUserSummary => ({
  _id: user._id,
  username: user.username,
  name: user.name,
  imageUrlCached: user.imageUrlCached,
});

const C1 = oid(101);
const C2 = oid(102);

describe('summarizeReactions', () => {
  it('makes a separate chip for each skin tone of the same emoji', () => {
    const rows = [
      row(C1, oid(1), 'unicode:+1', 1),
      row(C1, oid(2), 'unicode:+1::skin-tone-3', 2),
      row(C1, oid(3), 'unicode:+1::skin-tone-3', 3),
    ];

    const chips = summarizeReactions(rows, usersById, null, formatUser).get(C1);

    expect(chips?.map((c) => [c.emoji, c.count])).toEqual([
      ['unicode:+1', 1],
      ['unicode:+1::skin-tone-3', 2],
    ]);
  });

  it('orders chips by the earliest remaining row and users by createdAt', () => {
    // Input is deliberately not sorted
    const rows = [
      row(C1, oid(3), 'unicode:heart', 5),
      row(C1, oid(1), 'unicode:smile', 2),
      row(C1, oid(2), 'unicode:heart', 3),
    ];

    const chips = summarizeReactions(rows, usersById, null, formatUser).get(C1);

    expect(chips?.map((c) => c.emoji)).toEqual([
      'unicode:smile',
      'unicode:heart',
    ]);
    expect(
      chips?.[1].users.map((u) => (typeof u === 'string' ? u : u.name)),
    ).toEqual(['bob', 'carol']);
  });

  it('reorders chips when the first reactor of a chip has removed theirs', () => {
    // alice reacted heart first (minute 1) but removed it; only bob (minute 4) remains.
    // smile was added at minute 2, so smile now precedes heart.
    const rows = [
      row(C1, oid(1), 'unicode:smile', 2),
      row(C1, oid(2), 'unicode:heart', 4),
    ];

    const chips = summarizeReactions(rows, usersById, null, formatUser).get(C1);

    expect(chips?.map((c) => c.emoji)).toEqual([
      'unicode:smile',
      'unicode:heart',
    ]);
  });

  it('sets reactedByMe only when a row matches the viewer', () => {
    const rows = [
      row(C1, oid(1), 'unicode:smile', 1),
      row(C1, oid(2), 'unicode:heart', 2),
    ];

    const asAlice = summarizeReactions(rows, usersById, oid(1), formatUser).get(
      C1,
    );
    expect(asAlice?.map((c) => [c.emoji, c.reactedByMe])).toEqual([
      ['unicode:smile', true],
      ['unicode:heart', false],
    ]);

    const asGuest = summarizeReactions(rows, usersById, null, formatUser).get(
      C1,
    );
    expect(asGuest?.every((c) => c.reactedByMe === false)).toBe(true);
  });

  it('counts rows whose user no longer exists and represents them by id string', () => {
    const missing = oid(77);
    const rows = [
      row(C1, oid(1), 'unicode:smile', 1),
      row(C1, missing, 'unicode:smile', 2),
    ];

    const chip = summarizeReactions(rows, usersById, null, formatUser).get(
      C1,
    )?.[0];

    expect(chip?.count).toBe(2);
    expect(chip?.users[1]).toBe(missing);
    expect(typeof chip?.users[0]).toBe('object');
  });

  it('uses the result of the supplied formatter for existing users', () => {
    const rows = [row(C1, oid(1), 'unicode:smile', 1)];
    const custom = (user: ReactionUserRow): ReactionUserSummary => ({
      _id: user._id,
      username: 'formatted',
      name: 'formatted-name',
      imageUrlCached: 'formatted-img',
    });

    const chip = summarizeReactions(rows, usersById, null, custom).get(C1)?.[0];

    expect(chip?.users).toEqual([
      {
        _id: oid(1),
        username: 'formatted',
        name: 'formatted-name',
        imageUrlCached: 'formatted-img',
      },
    ]);
  });

  it('groups chips per comment', () => {
    const rows = [
      row(C1, oid(1), 'unicode:smile', 1),
      row(C2, oid(2), 'unicode:heart', 2),
    ];

    const result = summarizeReactions(rows, usersById, null, formatUser);

    expect(result.get(C1)?.map((c) => c.emoji)).toEqual(['unicode:smile']);
    expect(result.get(C2)?.map((c) => c.emoji)).toEqual(['unicode:heart']);
  });

  it('does not mutate its input rows', () => {
    const rows = [
      row(C1, oid(2), 'unicode:heart', 5),
      row(C1, oid(1), 'unicode:smile', 2),
    ];
    const snapshot = structuredClone(rows);

    summarizeReactions(rows, usersById, null, formatUser);

    expect(rows).toEqual(snapshot);
  });

  it('keeps chronological user order and chip order when one chip has many rows', () => {
    const COUNT = 500;
    const rows = Array.from({ length: COUNT }, (_, i) =>
      row(C1, oid(1000 + i), 'unicode:+1', COUNT - i),
    );
    rows.push(row(C1, oid(1), 'unicode:heart', 0));

    const chips = summarizeReactions(rows, usersById, null, formatUser).get(C1);

    expect(chips?.map((c) => [c.emoji, c.count])).toEqual([
      ['unicode:heart', 1],
      ['unicode:+1', COUNT],
    ]);
    expect(chips?.[1].users[0]).toBe(oid(1000 + COUNT - 1));
    expect(chips?.[1].users[COUNT - 1]).toBe(oid(1000));
  });
});
