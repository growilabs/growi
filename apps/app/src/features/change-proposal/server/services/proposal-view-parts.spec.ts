import { toProposalHeaderView } from './proposal-view-parts';

const baseArgs = {
  id: 'p1',
  proposal: {
    entry: 'mcp' as const,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lifecycle: 'open' as const,
    perPageNotifications: false,
  },
  visible: [],
  requester: { id: 'u1', username: 'alice', name: 'Alice' },
  isPerPageNotificationsEnabled: true,
};

describe('toProposalHeaderView viewerRole', () => {
  it('is requester for the requester (Reviewers Req 5.1)', () => {
    const view = toProposalHeaderView({ ...baseArgs, isRequester: true });
    expect(view.viewerRole).toBe('requester');
  });

  it('is other for a non-requester', () => {
    const view = toProposalHeaderView({ ...baseArgs, isRequester: false });
    expect(view.viewerRole).toBe('other');
  });
});
