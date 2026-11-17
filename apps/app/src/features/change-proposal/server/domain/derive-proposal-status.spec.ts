import type {
  OperationStatus,
  ProposalLifecycle,
  ProposalStatus,
} from '../../interfaces';
import { deriveProposalStatus } from './derive-proposal-status';

const ops = (...statuses: OperationStatus[]) =>
  statuses.map((status) => ({ status }));

describe('deriveProposalStatus', () => {
  describe('rule 1: open with a waiting operation', () => {
    it('returns pending even when other operations were already applied', () => {
      expect(deriveProposalStatus('open', ops('applied', 'pending'))).toBe(
        'pending',
      );
    });

    it('does not return pending once the lifecycle is no longer open', () => {
      expect(deriveProposalStatus('settled', ops('applied', 'pending'))).toBe(
        'applied',
      );
    });
  });

  describe('rule 2: nothing was applied, reverted or refused', () => {
    it.each<[ProposalLifecycle, ProposalStatus]>([
      ['discarded', 'discarded'],
      ['expired', 'expired'],
      ['withdrawn', 'withdrawn'],
      ['open', 'not-applied'],
      ['settled', 'not-applied'],
    ])('lifecycle %s gives %s', (lifecycle, expected) => {
      expect(deriveProposalStatus(lifecycle, ops('skipped', 'failed'))).toBe(
        expected,
      );
    });

    it('returns not-applied for a settled proposal whose operations all failed or went stale', () => {
      expect(deriveProposalStatus('settled', ops('failed', 'stale'))).toBe(
        'not-applied',
      );
    });

    it('returns not-applied for an open proposal with no operations', () => {
      expect(deriveProposalStatus('open', [])).toBe('not-applied');
    });
  });

  describe('rule 3: everything that took part was reverted', () => {
    it('returns reverted', () => {
      expect(deriveProposalStatus('settled', ops('reverted', 'reverted'))).toBe(
        'reverted',
      );
    });

    it('ignores failed, stale and skipped operations', () => {
      expect(
        deriveProposalStatus('settled', ops('reverted', 'failed', 'skipped')),
      ).toBe('reverted');
    });
  });

  describe('rule 4: at least one reverted, others still applied or refused', () => {
    it.each<OperationStatus>([
      'applied',
      'revert-refused',
    ])('returns partially-reverted when mixed with %s', (other) => {
      expect(deriveProposalStatus('settled', ops('reverted', other))).toBe(
        'partially-reverted',
      );
    });

    it('takes precedence over failed operations', () => {
      expect(
        deriveProposalStatus('settled', ops('reverted', 'applied', 'failed')),
      ).toBe('partially-reverted');
    });
  });

  describe('rule 5: applied with failed, stale or skipped operations', () => {
    it.each<OperationStatus>([
      'failed',
      'stale',
      'skipped',
    ])('returns partially-applied when an operation is %s', (other) => {
      expect(deriveProposalStatus('settled', ops('applied', other))).toBe(
        'partially-applied',
      );
    });

    it('treats revert-refused without reverted as applied-at-least-once', () => {
      expect(
        deriveProposalStatus('settled', ops('revert-refused', 'failed')),
      ).toBe('partially-applied');
    });
  });

  describe('rule 6: otherwise', () => {
    it('returns applied when every operation was applied', () => {
      expect(deriveProposalStatus('settled', ops('applied', 'applied'))).toBe(
        'applied',
      );
    });

    it('returns applied for revert-refused only', () => {
      expect(deriveProposalStatus('settled', ops('revert-refused'))).toBe(
        'applied',
      );
    });

    it('returns applied for an open proposal with no waiting operation left', () => {
      expect(deriveProposalStatus('open', ops('applied'))).toBe('applied');
    });
  });

  describe('view for someone other than the requester', () => {
    const visibleStates: OperationStatus[] = [
      'applied',
      'reverted',
      'revert-refused',
    ];

    it('never yields pending or partially-applied for any combination of visible operations', () => {
      const lifecycles: ProposalLifecycle[] = [
        'open',
        'settled',
        'discarded',
        'expired',
        'withdrawn',
      ];
      for (const lifecycle of lifecycles) {
        for (const a of visibleStates) {
          expect(['applied', 'reverted', 'partially-reverted']).toContain(
            deriveProposalStatus(lifecycle, ops(a)),
          );
          for (const b of visibleStates) {
            expect(['applied', 'reverted', 'partially-reverted']).toContain(
              deriveProposalStatus(lifecycle, ops(a, b)),
            );
          }
        }
      }
    });

    it('does not reveal a hidden failed operation when only visible ones are passed', () => {
      const all = ops('applied', 'failed');
      const visible = ops('applied');
      expect(deriveProposalStatus('settled', all)).toBe('partially-applied');
      expect(deriveProposalStatus('settled', visible)).toBe('applied');
    });
  });

  it('does not mutate its input', () => {
    const input = Object.freeze([
      Object.freeze({ status: 'applied' as const }),
    ]);
    expect(deriveProposalStatus('settled', input)).toBe('applied');
  });
});
