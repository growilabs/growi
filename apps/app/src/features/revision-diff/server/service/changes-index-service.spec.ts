import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';

import { buildRuns } from './changes-index-service';

// Helper to create a fresh ObjectId
const makeId = () => new Types.ObjectId();

describe('buildRuns', () => {
  it('連続する自分の編集を1つの run にまとめる', () => {
    const userId = makeId();
    const pageId = makeId();
    const rev1 = makeId();
    const rev2 = makeId();
    const rev3 = makeId();
    // the revision that precedes our run (authored by someone else)
    const before = makeId();
    const otherId = makeId(); // another user who wrote the previous revision

    const revisions = [
      {
        _id: rev1,
        pageId,
        author: userId,
        createdAt: new Date('2024-01-01T01:00:00Z'),
        prevAuthor: otherId, // the revision before rev1 was by another author → new run starts
        prevRevisionId: before, // that prior revision's _id is the baseline for this run
      },
      {
        _id: rev2,
        pageId,
        author: userId,
        createdAt: new Date('2024-01-01T02:00:00Z'),
        prevAuthor: userId, // prev revision was also by us → same run
        prevRevisionId: rev1,
      },
      {
        _id: rev3,
        pageId,
        author: userId,
        createdAt: new Date('2024-01-01T03:00:00Z'),
        prevAuthor: userId, // prev revision was also by us → same run
        prevRevisionId: rev2,
      },
    ];

    const runs = buildRuns(revisions, userId);

    expect(runs).toHaveLength(1);
    expect(runs[0].fromRevisionId?.toString()).toBe(before.toString());
    expect(runs[0].toRevisionId.toString()).toBe(rev3.toString());
    expect(runs[0].pageId.toString()).toBe(pageId.toString());
    expect(runs[0].authorId.toString()).toBe(userId.toString());
    expect(runs[0].latestUpdatedAt).toEqual(new Date('2024-01-01T03:00:00Z'));
  });

  it('他著者の版が割り込むと run が2つに分割される', () => {
    const userId = makeId();
    const otherId = makeId();
    const pageId = makeId();
    const rev1 = makeId();
    const otherRev = makeId(); // the other author's revision (not in our list)
    const rev2 = makeId();

    const revisions = [
      {
        _id: rev1,
        pageId,
        author: userId,
        createdAt: new Date('2024-01-01T01:00:00Z'),
        prevAuthor: null, // first revision on this page
        prevRevisionId: null, // page creation
      },
      // otherRev is by another author — it is not in our revisions list
      // (we only fetch revisions where author === userId)
      // but rev2 will have prevAuthor = otherId from $setWindowFields
      {
        _id: rev2,
        pageId,
        author: userId,
        createdAt: new Date('2024-01-01T03:00:00Z'),
        prevAuthor: otherId, // prev revision was by another author → new run starts
        prevRevisionId: otherRev, // baseline for the second run
      },
    ];

    const runs = buildRuns(revisions, userId);

    expect(runs).toHaveLength(2);

    // First run: only rev1, baseline is null (page creation)
    expect(runs[0].fromRevisionId).toBeNull();
    expect(runs[0].toRevisionId.toString()).toBe(rev1.toString());

    // Second run: rev2, baseline is otherRev (the intervening revision)
    expect(runs[1].fromRevisionId?.toString()).toBe(otherRev.toString());
    expect(runs[1].toRevisionId.toString()).toBe(rev2.toString());
  });

  it('新規作成（直前版なし）のとき fromRevisionId が null', () => {
    const userId = makeId();
    const pageId = makeId();
    const rev1 = makeId();

    const revisions = [
      {
        _id: rev1,
        pageId,
        author: userId,
        createdAt: new Date('2024-01-01T01:00:00Z'),
        prevAuthor: null, // first edit ever on this page
        prevRevisionId: null, // no prior revision
      },
    ];

    const runs = buildRuns(revisions, userId);

    expect(runs).toHaveLength(1);
    expect(runs[0].fromRevisionId).toBeNull();
    expect(runs[0].toRevisionId.toString()).toBe(rev1.toString());
    expect(runs[0].pageId.toString()).toBe(pageId.toString());
    expect(runs[0].authorId.toString()).toBe(userId.toString());
    expect(runs[0].latestUpdatedAt).toEqual(new Date('2024-01-01T01:00:00Z'));
  });

  it('複数ページの編集が混在しても、ページごとに独立した run を返す', () => {
    const userId = makeId();
    const pageA = makeId();
    const pageB = makeId();
    const revA1 = makeId();
    const revA2 = makeId();
    const revB1 = makeId();

    // Revisions sorted by (createdAt asc, _id asc) across pages
    const revisions = [
      {
        _id: revA1,
        pageId: pageA,
        author: userId,
        createdAt: new Date('2024-01-01T01:00:00Z'),
        prevAuthor: null,
        prevRevisionId: null,
      },
      {
        _id: revB1,
        pageId: pageB,
        author: userId,
        createdAt: new Date('2024-01-01T02:00:00Z'),
        prevAuthor: null,
        prevRevisionId: null,
      },
      {
        _id: revA2,
        pageId: pageA,
        author: userId,
        createdAt: new Date('2024-01-01T03:00:00Z'),
        prevAuthor: userId, // previous on pageA was userId (revA1)
        prevRevisionId: revA1,
      },
    ];

    const runs = buildRuns(revisions, userId);

    // pageB: 1 run (revB1 alone)
    // pageA: 1 run (revA1 extended to revA2)
    // Total: 2 runs
    expect(runs).toHaveLength(2);

    const runB = runs.find((r) => r.pageId.toString() === pageB.toString());
    const runA = runs.find((r) => r.pageId.toString() === pageA.toString());

    expect(runB).toBeDefined();
    expect(runB!.fromRevisionId).toBeNull();
    expect(runB!.toRevisionId.toString()).toBe(revB1.toString());

    expect(runA).toBeDefined();
    expect(runA!.fromRevisionId).toBeNull();
    expect(runA!.toRevisionId.toString()).toBe(revA2.toString());
  });

  it('入力が空配列のとき run も空', () => {
    const userId = makeId();
    const runs = buildRuns([], userId);
    expect(runs).toHaveLength(0);
  });
});
