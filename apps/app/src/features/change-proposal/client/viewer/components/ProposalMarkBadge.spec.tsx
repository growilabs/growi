// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import { ProposalMarkBadge } from './ProposalMarkBadge';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ProposalMarkBadge', () => {
  it('links a change proposal mark to the proposal detail page', () => {
    render(
      <ProposalMarkBadge
        mark={{ revisionId: 'rev1', proposalId: 'prop1', isRevert: false }}
      />,
    );

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/me/change-proposals/prop1');
    expect(link.textContent).toContain(
      'change_proposal_viewer.mark.change_proposal',
    );
  });

  it('labels a mark made by a revert differently and links to the proposal detail page', () => {
    render(
      <ProposalMarkBadge
        mark={{ revisionId: 'rev2', proposalId: 'prop2', isRevert: true }}
      />,
    );

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/me/change-proposals/prop2');
    expect(link.textContent).toContain('change_proposal_viewer.mark.revert');
    expect(link.textContent).not.toContain(
      'change_proposal_viewer.mark.change_proposal',
    );
  });
});
