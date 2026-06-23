import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';

import type { CursorKey } from '../cursor';
import type { PageInfo, Run } from './changes-index-service';
import {
  applyAccessFlags,
  buildRuns,
  paginateRuns,
} from './changes-index-service';

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

// ---------------------------------------------------------------------------
// paginateRuns
// ---------------------------------------------------------------------------

/** テスト用に Run を作るヘルパー */
function makeRun(toRevId: Types.ObjectId, createdAt: Date): Run {
  return {
    pageId: new Types.ObjectId(),
    fromRevisionId: null,
    toRevisionId: toRevId,
    authorId: new Types.ObjectId(),
    latestUpdatedAt: createdAt,
  };
}

describe('paginateRuns', () => {
  it('limit 内に収まる結果は next=null を返す', () => {
    const runs = [
      makeRun(new Types.ObjectId(), new Date('2024-01-01')),
      makeRun(new Types.ObjectId(), new Date('2024-01-02')),
    ];
    const result = paginateRuns(runs, 5);
    expect(result.emittedRuns).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('limit 超過時は limit 件だけ emit し next cursor を返す', () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      makeRun(new Types.ObjectId(), new Date(`2024-01-0${i + 1}`)),
    );
    const result = paginateRuns(runs, 3);
    expect(result.emittedRuns).toHaveLength(3);
    expect(result.nextCursor).not.toBeNull();
  });

  it('cursor 継続で前ページの重複・取りこぼしがない', () => {
    const revIds = Array.from({ length: 6 }, () => new Types.ObjectId());
    const dates = Array.from(
      { length: 6 },
      (_, i) => new Date(`2024-01-0${i + 1}`),
    );
    const runs = revIds.map((id, i) => makeRun(id, dates[i]));

    // Page 1
    const page1 = paginateRuns(runs, 3);
    expect(page1.emittedRuns).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();

    // Page 2（cursor を渡して継続）
    const page2 = paginateRuns(runs, 3, page1.nextCursor as CursorKey);
    expect(page2.emittedRuns).toHaveLength(3);
    expect(page2.nextCursor).toBeNull();

    // 重複なし
    const page1Ids = page1.emittedRuns.map((r) => r.toRevisionId.toString());
    const page2Ids = page2.emittedRuns.map((r) => r.toRevisionId.toString());
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);

    // 6 件全てカバー、取りこぼしなし
    expect([...page1Ids, ...page2Ids]).toHaveLength(6);
    // 元の runs 全 ID が含まれる
    const allRunIds = runs.map((r) => r.toRevisionId.toString());
    expect([...page1Ids, ...page2Ids].sort()).toEqual(allRunIds.sort());
  });

  it('結果が空のとき空配列と next=null を返す', () => {
    const result = paginateRuns([], 5);
    expect(result.emittedRuns).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it('emit 済み runs は時系列昇順になっている', () => {
    // 意図的に逆順で渡す（呼び出し元は昇順ソート済みが前提だが、順序の検証）
    const sorted = [
      makeRun(new Types.ObjectId(), new Date('2024-01-01')),
      makeRun(new Types.ObjectId(), new Date('2024-01-02')),
      makeRun(new Types.ObjectId(), new Date('2024-01-03')),
    ];
    const result = paginateRuns(sorted, 10);
    for (let i = 1; i < result.emittedRuns.length; i++) {
      expect(
        result.emittedRuns[i - 1].latestUpdatedAt.getTime(),
      ).toBeLessThanOrEqual(result.emittedRuns[i].latestUpdatedAt.getTime());
    }
  });

  it('cursor がちょうど最終 run を指すとき次ページは空で next=null', () => {
    const revId = new Types.ObjectId();
    const date = new Date('2024-01-01');
    const runs = [makeRun(revId, date)];

    // 1 件だけのリストを全て取得
    const page1 = paginateRuns(runs, 5);
    expect(page1.emittedRuns).toHaveLength(1);
    expect(page1.nextCursor).toBeNull();
  });

  it('cursor 直後の run から始まり、cursor と同時刻で _id が大きい run も含める', () => {
    // 同一 createdAt の run が複数ある場合、toRevisionId (_id) の文字列比較で順序付け
    const date = new Date('2024-01-01');
    // ObjectId の toString() は 24 桁 hex: 辞書順で大小が決まる
    // 明示的に小さい/大きい ID を作るのは困難なので、複数生成して Sort で確認
    const revIds = Array.from({ length: 4 }, () => new Types.ObjectId());
    // latestUpdatedAt が全て同じ date のケース
    const runs = revIds.map((id) => makeRun(id, date));

    // ソート（実装に合わせ latestUpdatedAt asc, toRevisionId str asc）
    const sorted = [...runs].sort((a, b) => {
      const timeDiff =
        a.latestUpdatedAt.getTime() - b.latestUpdatedAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.toRevisionId.toString() < b.toRevisionId.toString() ? -1 : 1;
    });

    // Page 1: 2 件
    const page1 = paginateRuns(sorted, 2);
    expect(page1.emittedRuns).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    // Page 2: 残り 2 件
    const page2 = paginateRuns(sorted, 2, page1.nextCursor as CursorKey);
    expect(page2.emittedRuns).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    // 全 4 件が重複なくカバーされる
    const allIds = [...page1.emittedRuns, ...page2.emittedRuns].map((r) =>
      r.toRevisionId.toString(),
    );
    expect(allIds.sort()).toEqual(
      sorted.map((r) => r.toRevisionId.toString()).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// applyAccessFlags
// ---------------------------------------------------------------------------

/** テスト用に Run を作るヘルパー（pageId を指定可能） */
function makeRunForPage(pageId: Types.ObjectId): Run {
  return {
    pageId,
    fromRevisionId: new Types.ObjectId(),
    toRevisionId: new Types.ObjectId(),
    authorId: new Types.ObjectId(),
    latestUpdatedAt: new Date('2024-01-01T00:00:00Z'),
  };
}

/** テスト用に PageInfo を作るヘルパー */
function makePageInfo(
  id: Types.ObjectId,
  status: string,
  path: string,
): PageInfo {
  return { _id: id, status, path };
}

describe('applyAccessFlags', () => {
  it('accessible ページは accessible:true, deleted:false, path 付きで返す', () => {
    const pageId = makeId();
    const runs = [makeRunForPage(pageId)];
    const accessiblePageIds = new Set([pageId.toString()]);
    const pageInfoMap = new Map([
      [pageId.toString(), makePageInfo(pageId, 'published', '/path/to/page')],
    ]);

    const result = applyAccessFlags(runs, accessiblePageIds, pageInfoMap);

    expect(result).toHaveLength(1);
    expect(result[0].pageId).toBe(pageId.toString());
    expect(result[0].accessible).toBe(true);
    expect(result[0].deleted).toBe(false);
    expect(result[0].path).toBe('/path/to/page');
  });

  it('deleted ページ (status=deleted) は accessible:false, deleted:true, path:null で返す', () => {
    const pageId = makeId();
    const runs = [makeRunForPage(pageId)];
    // accessiblePageIds には含まれない
    const accessiblePageIds = new Set<string>();
    const pageInfoMap = new Map([
      [pageId.toString(), makePageInfo(pageId, 'deleted', '/trash/page')],
    ]);

    const result = applyAccessFlags(runs, accessiblePageIds, pageInfoMap);

    expect(result).toHaveLength(1);
    expect(result[0].pageId).toBe(pageId.toString());
    expect(result[0].accessible).toBe(false);
    expect(result[0].deleted).toBe(true);
    expect(result[0].path).toBeNull();
  });

  it('閲覧不可ページ (status≠deleted, accessiblePageIds に無い) は accessible:false, deleted:false, path:null で返す', () => {
    const pageId = makeId();
    const runs = [makeRunForPage(pageId)];
    // accessiblePageIds には含まれない
    const accessiblePageIds = new Set<string>();
    const pageInfoMap = new Map([
      [pageId.toString(), makePageInfo(pageId, 'published', '/private/page')],
    ]);

    const result = applyAccessFlags(runs, accessiblePageIds, pageInfoMap);

    expect(result).toHaveLength(1);
    expect(result[0].pageId).toBe(pageId.toString());
    expect(result[0].accessible).toBe(false);
    expect(result[0].deleted).toBe(false);
    expect(result[0].path).toBeNull();
  });

  it('不在ページ (pageInfoMap に無い) は結果から除外される', () => {
    const pageId = makeId();
    const runs = [makeRunForPage(pageId)];
    const accessiblePageIds = new Set<string>();
    // pageInfoMap は空 — DB にページが存在しない
    const pageInfoMap = new Map<string, PageInfo>();

    const result = applyAccessFlags(runs, accessiblePageIds, pageInfoMap);

    expect(result).toHaveLength(0);
  });

  it('混在: accessible / deleted / 閲覧不可 / 不在 が混ざる場合、不在のみ除外し残り3件を正しいフラグで返す', () => {
    const accessibleId = makeId();
    const deletedId = makeId();
    const inaccessibleId = makeId();
    const absentId = makeId();

    const runs = [
      makeRunForPage(accessibleId),
      makeRunForPage(deletedId),
      makeRunForPage(inaccessibleId),
      makeRunForPage(absentId),
    ];

    const accessiblePageIds = new Set([accessibleId.toString()]);
    const pageInfoMap = new Map([
      [
        accessibleId.toString(),
        makePageInfo(accessibleId, 'published', '/accessible'),
      ],
      [
        deletedId.toString(),
        makePageInfo(deletedId, 'deleted', '/trash/deleted'),
      ],
      [
        inaccessibleId.toString(),
        makePageInfo(inaccessibleId, 'published', '/private'),
      ],
      // absentId は pageInfoMap に無い
    ]);

    const result = applyAccessFlags(runs, accessiblePageIds, pageInfoMap);

    // 不在 (absentId) は除外 → 3件のみ
    expect(result).toHaveLength(3);

    const accessibleEntry = result.find(
      (e) => e.pageId === accessibleId.toString(),
    );
    expect(accessibleEntry).toBeDefined();
    if (accessibleEntry == null) return;
    expect(accessibleEntry.accessible).toBe(true);
    expect(accessibleEntry.deleted).toBe(false);
    expect(accessibleEntry.path).toBe('/accessible');

    const deletedEntry = result.find((e) => e.pageId === deletedId.toString());
    expect(deletedEntry).toBeDefined();
    if (deletedEntry == null) return;
    expect(deletedEntry.accessible).toBe(false);
    expect(deletedEntry.deleted).toBe(true);
    expect(deletedEntry.path).toBeNull();

    const inaccessibleEntry = result.find(
      (e) => e.pageId === inaccessibleId.toString(),
    );
    expect(inaccessibleEntry).toBeDefined();
    if (inaccessibleEntry == null) return;
    expect(inaccessibleEntry.accessible).toBe(false);
    expect(inaccessibleEntry.deleted).toBe(false);
    expect(inaccessibleEntry.path).toBeNull();
  });

  it('accessible かつ deleted なページ（ゴミ箱で GRANT_PUBLIC 等）は deleted:true, path:null で返す', () => {
    const pageId = new Types.ObjectId();
    const revId = new Types.ObjectId();
    const authorId = new Types.ObjectId();
    const runs: Run[] = [
      {
        pageId,
        fromRevisionId: null,
        toRevisionId: revId,
        authorId,
        latestUpdatedAt: new Date('2024-01-01'),
      },
    ];
    // findByIdsAndViewer returns this page (GRANT_PUBLIC deleted page — still accessible by grant)
    const accessiblePageIds = new Set([pageId.toString()]);
    const pageInfoMap = new Map<string, PageInfo>([
      [
        pageId.toString(),
        { _id: pageId, status: 'deleted', path: '/trash/my-page' },
      ],
    ]);

    const result = applyAccessFlags(runs, accessiblePageIds, pageInfoMap);

    expect(result).toHaveLength(1);
    expect(result[0].accessible).toBe(true); // grant-accessible but deleted
    expect(result[0].deleted).toBe(true);
    expect(result[0].path).toBeNull(); // CRITICAL: path must not leak even if accessible
  });
});
