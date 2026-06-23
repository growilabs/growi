import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';

import type { RevisionDiffPairInput } from '../../interfaces/revision-diff';
import type { RevisionDoc } from './revision-diff-service';
import { computeDiffForPair, MAX_PAIRS } from './revision-diff-service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeId(): Types.ObjectId {
  return new Types.ObjectId();
}

function makeRev(
  id: Types.ObjectId,
  pageId: Types.ObjectId,
  body: string,
): RevisionDoc {
  return { _id: id, pageId, body };
}

function makePair(
  pageId: Types.ObjectId,
  fromRevisionId: Types.ObjectId | null,
  toRevisionId: Types.ObjectId,
): RevisionDiffPairInput {
  return {
    pageId: pageId.toString(),
    fromRevisionId: fromRevisionId?.toString() ?? null,
    toRevisionId: toRevisionId.toString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeDiffForPair', () => {
  // -------------------------------------------------------------------------
  // ok path — accessible page, valid pair
  // -------------------------------------------------------------------------

  it('アクセス可能なページの版ペアは ok ステータスと unified diff を返す', () => {
    const pageId = makeId();
    const fromId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    const revisionMap = new Map<string, RevisionDoc>([
      [fromId.toString(), makeRev(fromId, pageId, 'original\n')],
      [toId.toString(), makeRev(toId, pageId, 'modified\n')],
    ]);

    const result = computeDiffForPair(
      makePair(pageId, fromId, toId),
      accessiblePageIds,
      revisionMap,
      3,
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.diff).toContain('-original');
      expect(result.diff).toContain('+modified');
    }
  });

  it('ok 結果には pageId と toRevisionId が含まれる', () => {
    const pageId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    const revisionMap = new Map([
      [toId.toString(), makeRev(toId, pageId, 'body\n')],
    ]);

    const result = computeDiffForPair(
      makePair(pageId, null, toId),
      accessiblePageIds,
      revisionMap,
      3,
    );

    expect(result.status).toBe('ok');
    expect(result.pageId).toBe(pageId.toString());
    expect(result.toRevisionId).toBe(toId.toString());
  });

  // -------------------------------------------------------------------------
  // fromRevisionId === null — full-add baseline (page creation)
  // -------------------------------------------------------------------------

  it('fromRevisionId が null のとき全文追加として diff を返す（新規作成 baseline）', () => {
    const pageId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    const revisionMap = new Map([
      [toId.toString(), makeRev(toId, pageId, 'new content\n')],
    ]);

    const result = computeDiffForPair(
      makePair(pageId, null, toId),
      accessiblePageIds,
      revisionMap,
      3,
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      // Every line is an addition (no removed lines).
      expect(result.diff).toContain('+new content');
      // No removed lines (lines starting with a single "-" character).
      expect(result.diff).not.toMatch(/^-[^-]/m);
    }
  });

  // -------------------------------------------------------------------------
  // forbidden — page not accessible
  // -------------------------------------------------------------------------

  it('閲覧不可のページは forbidden を返し diff を含めない', () => {
    const pageId = makeId();
    const toId = makeId();

    const result = computeDiffForPair(
      makePair(pageId, null, toId),
      new Set(), // empty → not accessible
      new Map([[toId.toString(), makeRev(toId, pageId, 'secret\n')]]),
      3,
    );

    expect(result.status).toBe('forbidden');
    // forbidden result must not disclose content.
    expect(Object.keys(result)).not.toContain('diff');
  });

  it('forbidden 結果には pageId と toRevisionId が含まれる', () => {
    const pageId = makeId();
    const toId = makeId();

    const result = computeDiffForPair(
      makePair(pageId, null, toId),
      new Set(),
      new Map([[toId.toString(), makeRev(toId, pageId, 'secret\n')]]),
      3,
    );

    expect(result.status).toBe('forbidden');
    expect(result.pageId).toBe(pageId.toString());
    expect(result.toRevisionId).toBe(toId.toString());
  });

  // -------------------------------------------------------------------------
  // invalid — revision not found or belongs to wrong page
  // -------------------------------------------------------------------------

  it('toRevision が revisionMap に存在しない場合は invalid を返す', () => {
    const pageId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    // revisionMap is empty — toRevision not found.
    const result = computeDiffForPair(
      makePair(pageId, null, toId),
      accessiblePageIds,
      new Map(),
      3,
    );

    expect(result.status).toBe('invalid');
  });

  it('toRevision が指定 pageId に属さない場合は invalid を返す', () => {
    const pageId = makeId();
    const otherPageId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    // toRevision belongs to otherPageId, not pageId.
    const revisionMap = new Map([
      [toId.toString(), makeRev(toId, otherPageId, 'body\n')],
    ]);

    const result = computeDiffForPair(
      makePair(pageId, null, toId),
      accessiblePageIds,
      revisionMap,
      3,
    );

    expect(result.status).toBe('invalid');
  });

  it('fromRevision が revisionMap に存在しない場合は invalid を返す', () => {
    const pageId = makeId();
    const fromId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    // Only toRevision is in the map; fromRevision is absent.
    const revisionMap = new Map([
      [toId.toString(), makeRev(toId, pageId, 'body\n')],
    ]);

    const result = computeDiffForPair(
      makePair(pageId, fromId, toId),
      accessiblePageIds,
      revisionMap,
      3,
    );

    expect(result.status).toBe('invalid');
  });

  it('fromRevision が指定 pageId に属さない場合は invalid を返す', () => {
    const pageId = makeId();
    const otherPageId = makeId();
    const fromId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    const revisionMap = new Map<string, RevisionDoc>([
      // fromRevision belongs to a different page.
      [fromId.toString(), makeRev(fromId, otherPageId, 'original\n')],
      [toId.toString(), makeRev(toId, pageId, 'modified\n')],
    ]);

    const result = computeDiffForPair(
      makePair(pageId, fromId, toId),
      accessiblePageIds,
      revisionMap,
      3,
    );

    expect(result.status).toBe('invalid');
  });

  it('invalid 結果には diff を含めない', () => {
    const pageId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    const result = computeDiffForPair(
      makePair(pageId, null, toId),
      accessiblePageIds,
      new Map(),
      3,
    );

    expect(result.status).toBe('invalid');
    expect(Object.keys(result)).not.toContain('diff');
  });

  // -------------------------------------------------------------------------
  // Batch partial success — independent per-pair authorization
  // -------------------------------------------------------------------------

  it('バッチ内の一部成功・一部失敗が混在できる（独立認可）', () => {
    const goodPageId = makeId();
    const badPageId = makeId();
    const toId1 = makeId();
    const toId2 = makeId();

    // Only goodPageId is accessible; badPageId is not.
    const accessiblePageIds = new Set([goodPageId.toString()]);
    const revisionMap = new Map<string, RevisionDoc>([
      [toId1.toString(), makeRev(toId1, goodPageId, 'good content\n')],
      [toId2.toString(), makeRev(toId2, badPageId, 'secret content\n')],
    ]);

    const result1 = computeDiffForPair(
      makePair(goodPageId, null, toId1),
      accessiblePageIds,
      revisionMap,
      3,
    );
    const result2 = computeDiffForPair(
      makePair(badPageId, null, toId2),
      accessiblePageIds,
      revisionMap,
      3,
    );

    expect(result1.status).toBe('ok');
    expect(result2.status).toBe('forbidden');
  });

  it('① 由来でない不正ペア（IDOR 試行）でも独立認可が動作する', () => {
    // An attacker constructs a pair referencing a page they cannot access.
    // Even if the revision exists in the map, forbidden must be returned.
    const restrictedPageId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set<string>(); // attacker cannot access restrictedPageId
    const revisionMap = new Map([
      [toId.toString(), makeRev(toId, restrictedPageId, 'confidential\n')],
    ]);

    const result = computeDiffForPair(
      makePair(restrictedPageId, null, toId),
      accessiblePageIds,
      revisionMap,
      3,
    );

    expect(result.status).toBe('forbidden');
    expect(Object.keys(result)).not.toContain('diff');
  });

  // -------------------------------------------------------------------------
  // Context lines
  // -------------------------------------------------------------------------

  it('contextLines=0 では変更行のみ diff に含まれる（周囲の文脈行なし）', () => {
    const pageId = makeId();
    const fromId = makeId();
    const toId = makeId();

    const accessiblePageIds = new Set([pageId.toString()]);
    // 5 lines; only the middle line changes.
    const fromBody = 'a\nb\nc\nd\ne\n';
    const toBody = 'a\nb\nX\nd\ne\n';
    const revisionMap = new Map<string, RevisionDoc>([
      [fromId.toString(), makeRev(fromId, pageId, fromBody)],
      [toId.toString(), makeRev(toId, pageId, toBody)],
    ]);

    const result = computeDiffForPair(
      makePair(pageId, fromId, toId),
      accessiblePageIds,
      revisionMap,
      0,
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.diff).toContain('-c');
      expect(result.diff).toContain('+X');
      // With context=0, surrounding lines 'a','b','d','e' should not appear as context.
      expect(result.diff).not.toMatch(/^ a/m);
      expect(result.diff).not.toMatch(/^ e/m);
    }
  });

  // -------------------------------------------------------------------------
  // MAX_PAIRS constant
  // -------------------------------------------------------------------------

  it('MAX_PAIRS は 20 である', () => {
    expect(MAX_PAIRS).toBe(20);
  });
});
