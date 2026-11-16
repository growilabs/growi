import type { ViewerRole } from '../../interfaces';
import { toProposalHeaderView } from './proposal-view-parts';

const baseArgs = {
  id: 'p1',
  proposal: {
    entry: 'mcp' as const,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastAppliedAt: new Date('2026-01-03T00:00:00Z'),
    lifecycle: 'open' as const,
    perPageNotifications: false,
  },
  visible: [],
  requester: { id: 'u1', username: 'alice', name: 'Alice' },
  isPerPageNotificationsEnabled: true,
};

describe('toProposalHeaderView', () => {
  describe.each<ViewerRole>([
    'requester',
    'reviewer',
    'other',
  ])('viewerRole for %s', (role) => {
    it('is the role the caller derived (Reviewers Req 5.1)', () => {
      const view = toProposalHeaderView({ ...baseArgs, role });

      expect(view.viewerRole).toBe(role);
      expect(view.isRequester).toBe(role === 'requester');
    });
  });

  describe('the overall status of a discarded proposal whose only visible operation failed', () => {
    const args = {
      ...baseArgs,
      proposal: { ...baseArgs.proposal, lifecycle: 'discarded' as const },
      visible: [
        { status: 'failed' as const, reason: 'path-occupied' as const },
      ],
    };

    it('comes from the actual stage for the requester', () => {
      expect(toProposalHeaderView({ ...args, role: 'requester' }).status).toBe(
        'discarded',
      );
    });

    it.each<ViewerRole>([
      'reviewer',
      'other',
    ])('comes from the visible operations alone for %s, never the actual stage (Reviewers Req 5.6)', (role) => {
      expect(toProposalHeaderView({ ...args, role }).status).toBe(
        'not-applied',
      );
    });
  });

  it('reads a reviewer the stage of a visible operation skipped by the discard (Reviewers Req 5.6)', () => {
    const view = toProposalHeaderView({
      ...baseArgs,
      proposal: { ...baseArgs.proposal, lifecycle: 'discarded' },
      visible: [{ status: 'skipped', reason: 'discarded' }],
      role: 'reviewer',
    });

    expect(view.status).toBe('discarded');
  });

  it('keeps the requester-only state and the stored lastAppliedAt from a reviewer (Reviewers Req 5.6, 5.8)', () => {
    const appliedAt = new Date('2026-01-02T00:00:00Z');
    const view = toProposalHeaderView({
      ...baseArgs,
      visible: [{ status: 'applied', appliedAt }],
      role: 'reviewer',
    });

    expect(view).not.toHaveProperty('requesterState');
    expect(view.lastAppliedAt).toBe(appliedAt.toISOString());
  });
});
