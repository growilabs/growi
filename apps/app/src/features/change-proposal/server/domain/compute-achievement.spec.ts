import type { OperationRecord, OperationStatus } from '../../interfaces';
import { computeAchievement } from './compute-achievement';

type Op = Pick<OperationRecord, 'status' | 'reason'>;
const op = (status: OperationStatus, reason?: Op['reason']): Op => ({
  status,
  reason,
});

describe('computeAchievement', () => {
  it('returns undefined for a revert proposal', () => {
    expect(
      computeAchievement('revert', [op('applied'), op('stale')]),
    ).toBeUndefined();
  });

  it.each([
    'ai-chat',
    'vault',
    'mcp',
  ] as const)('returns a result for the %s entry', (entry) => {
    expect(computeAchievement(entry, [op('applied')])).toEqual({
      applied: 1,
      attempted: 1,
    });
  });

  it('counts applied, reverted and revert-refused as applied at least once', () => {
    expect(
      computeAchievement('ai-chat', [
        op('applied'),
        op('reverted'),
        op('revert-refused', 'edited-after-apply'),
        op('failed', 'write-error'),
        op('pending'),
      ]),
    ).toEqual({ applied: 3, attempted: 5 });
  });

  it('excludes operations the requester skipped from attempted', () => {
    expect(
      computeAchievement('mcp', [
        op('applied'),
        op('skipped', 'skipped-by-requester'),
        op('skipped', 'skipped-by-requester'),
      ]),
    ).toEqual({ applied: 1, attempted: 1 });
  });

  it('keeps other skipped reasons in attempted', () => {
    expect(
      computeAchievement('mcp', [
        op('applied'),
        op('skipped', 'discarded'),
        op('skipped', 'page-being-edited'),
        op('skipped'),
      ]),
    ).toEqual({ applied: 1, attempted: 4 });
  });

  it('returns 0 and 0 when every operation was skipped by the requester', () => {
    expect(
      computeAchievement('vault', [op('skipped', 'skipped-by-requester')]),
    ).toEqual({ applied: 0, attempted: 0 });
  });

  it('returns 0 and 0 for no operations', () => {
    expect(computeAchievement('vault', [])).toEqual({
      applied: 0,
      attempted: 0,
    });
  });
});
