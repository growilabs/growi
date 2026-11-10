import { mock } from 'vitest-mock-extended';

import type {
  OperationReason,
  OperationStatus,
  OperationView,
  ProposalAchievement,
} from '../../interfaces';
import {
  selectRemainingOperations,
  toAchievementPercent,
} from './proposal-progress';

const achievement = (
  applied: number,
  attempted: number,
): ProposalAchievement => ({ applied, attempted });

const op = (
  key: string,
  status: OperationStatus,
  reason?: OperationReason,
): OperationView => mock<OperationView>({ key, status, reason });

describe('toAchievementPercent', () => {
  it('returns null when nothing was attempted', () => {
    expect(toAchievementPercent(achievement(0, 0))).toBeNull();
  });

  it('floors the ratio (99.6% becomes 99)', () => {
    expect(toAchievementPercent(achievement(249, 250))).toBe(99);
  });

  it('returns 100 when everything attempted was applied', () => {
    expect(toAchievementPercent(achievement(3, 3))).toBe(100);
  });

  it('returns 0 when attempted but nothing applied', () => {
    expect(toAchievementPercent(achievement(0, 4))).toBe(0);
  });

  it('floors a repeating fraction (1 of 3 is 33)', () => {
    expect(toAchievementPercent(achievement(1, 3))).toBe(33);
  });
});

describe('selectRemainingOperations', () => {
  it('keeps stale, failed and skipped operations', () => {
    const operations = [
      op('a', 'stale', 'base-revision-changed'),
      op('b', 'failed', 'write-error'),
      op('c', 'skipped', 'expired'),
    ];
    expect(selectRemainingOperations(operations).map((o) => o.key)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('excludes pending (waiting) operations', () => {
    const operations = [
      op('a', 'pending', 'page-being-edited'),
      op('b', 'failed', 'write-error'),
    ];
    expect(selectRemainingOperations(operations).map((o) => o.key)).toEqual([
      'b',
    ]);
  });

  it('excludes operations the requester skipped on purpose', () => {
    const operations = [
      op('a', 'skipped', 'skipped-by-requester'),
      op('b', 'skipped', 'discarded'),
    ];
    expect(selectRemainingOperations(operations).map((o) => o.key)).toEqual([
      'b',
    ]);
  });

  it('excludes applied, reverted and revert-refused operations', () => {
    const operations = [
      op('a', 'applied'),
      op('b', 'reverted'),
      op('c', 'revert-refused', 'edited-after-apply'),
    ];
    expect(selectRemainingOperations(operations)).toEqual([]);
  });
});

describe('toAchievementPercent exactness', () => {
  it('matches integer-exact floor division for every attempted 1..100 and applied 0..attempted', () => {
    const mismatches: string[] = [];
    for (let attempted = 1; attempted <= 100; attempted++) {
      for (let applied = 0; applied <= attempted; applied++) {
        const expected =
          (applied * 100 - ((applied * 100) % attempted)) / attempted;
        const actual = toAchievementPercent(achievement(applied, attempted));
        if (actual !== expected) {
          mismatches.push(`${applied}/${attempted}: ${actual} != ${expected}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
