// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import type { ChangeProposalView } from '../../../../interfaces';
import { ProposalSummaryHeader } from './ProposalSummaryHeader';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
});
