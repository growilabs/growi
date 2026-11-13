// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import type { ChangeProposalView } from '../../../../interfaces';
import type { ProposalActionSlotProps } from '../requester-action-slots';
import { ProposalSummaryHeader } from './ProposalSummaryHeader';

const mocks = vi.hoisted(() => {
  const slots: Record<string, unknown> = {};
  return { slots };
});

vi.mock('../requester-action-slots', () => ({
  REQUESTER_ACTION_SLOTS: mocks.slots,
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options == null ? key : `${key}|${JSON.stringify(options)}`,
  }),
}));

const createProposal = (
  overrides: Partial<ChangeProposalView> = {},
): ChangeProposalView => ({
  id: 'proposal-1',
  requester: { id: 'user-1', username: 'alice', name: 'Alice Smith' },
  entry: 'mcp',
  createdAt: '2026-03-04T05:06:07.000Z',
  status: 'pending',
  isRequester: false,
  operations: [],
  ...overrides,
});

describe('ProposalSummaryHeader', () => {
  it('places the progress word, the per-page notification wording and the based-on link for core-provided data', () => {
    render(
      <ProposalSummaryHeader
        proposal={createProposal({
          isRequester: true,
          requesterState: {
            lifecycle: 'settled',
            achievement: { applied: 1, attempted: 2 },
            perPageNotifications: { value: true, isEnabledBySettings: true },
          },
          basedOn: {
            proposalId: 'base0000deadbeef',
            relation: 'rework',
            operationKeys: [],
          },
        })}
      />,
    );
    expect(
      screen.getByText(
        'change_proposal.achievement.settled_with_percent|{"percent":50}',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('change_proposal_viewer.per_page_notifications.enabled'),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '#deadbeef' }).getAttribute('href'),
    ).toBe('/me/change-proposals/base0000deadbeef');
    expect(screen.getByText('change_proposal.link.based_on')).toBeTruthy();
  });

  it('places none of them when core returned no requester state and no base', () => {
    render(<ProposalSummaryHeader proposal={createProposal()} />);
    expect(screen.queryByText(/change_proposal.achievement/)).toBeNull();
    expect(screen.queryByText(/per_page_notifications/)).toBeNull();
    expect(screen.queryByText('change_proposal.link.based_on')).toBeNull();
  });

  it('omits the model name when core returned none', () => {
    render(<ProposalSummaryHeader proposal={createProposal()} />);
    expect(
      screen.queryByText('change_proposal_viewer.detail.model'),
    ).toBeNull();
  });

  it('shows the model name when core returned one', () => {
    render(
      <ProposalSummaryHeader
        proposal={createProposal({ modelLabel: 'model-y' })}
      />,
    );
    expect(screen.getByText('model-y')).toBeTruthy();
  });

  describe('requester action slot', () => {
    afterEach(() => {
      delete mocks.slots.mcp;
    });

    it('places the proposal-level component of the entry for the requester', async () => {
      mocks.slots.mcp = {
        proposal:
          async () =>
          ({ proposal }: ProposalActionSlotProps) => (
            <span data-testid="header-slot">{proposal.id}</span>
          ),
      };
      render(
        <ProposalSummaryHeader
          proposal={createProposal({ isRequester: true })}
        />,
      );

      expect((await screen.findByTestId('header-slot')).textContent).toBe(
        'proposal-1',
      );
    });

    it('places nothing for a non-requester', async () => {
      const loader = vi.fn();
      mocks.slots.mcp = { proposal: loader };
      render(<ProposalSummaryHeader proposal={createProposal()} />);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByTestId('header-slot')).toBeNull();
      expect(loader).not.toHaveBeenCalled();
    });
  });
});
