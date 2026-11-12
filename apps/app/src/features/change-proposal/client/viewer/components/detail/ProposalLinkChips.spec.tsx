// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import { ProposalLinkChips } from './ProposalLinkChips';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ProposalLinkChips', () => {
  it('links each core-provided link to its detail page with the relation word and one-hash short id', () => {
    render(
      <ProposalLinkChips
        links={[
          { proposalId: 'aaaaaaaa11111111', kind: 'follow-up' },
          { proposalId: 'bbbbbbbb22222222', kind: 'rework' },
          { proposalId: 'cccccccc33333333', kind: 'based-on' },
        ]}
      />,
    );

    const followUp = screen.getByRole('link', { name: '#11111111' });
    expect(followUp.getAttribute('href')).toBe(
      '/me/change-proposals/aaaaaaaa11111111',
    );
    expect(screen.getByText('change_proposal.link.follow_up')).toBeTruthy();

    const rework = screen.getByRole('link', { name: '#22222222' });
    expect(rework.getAttribute('href')).toBe(
      '/me/change-proposals/bbbbbbbb22222222',
    );
    expect(screen.getByText('change_proposal.link.rework')).toBeTruthy();

    const basedOn = screen.getByRole('link', { name: '#33333333' });
    expect(basedOn.getAttribute('href')).toBe(
      '/me/change-proposals/cccccccc33333333',
    );
    expect(screen.getByText('change_proposal.link.based_on')).toBeTruthy();
    expect(basedOn.textContent?.match(/#/g)).toHaveLength(1);
  });

  it('renders nothing when core returned no links', () => {
    const { container } = render(<ProposalLinkChips links={[]} />);
    expect(container.textContent).toBe('');
  });
});
