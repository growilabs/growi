// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';

import type { ChangeProposalSummaryView } from '../../../../interfaces';
import { ChangeProposalSummaryItem } from './ChangeProposalSummaryItem';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/components/User/UserDate', () => ({
  default: ({ dateTime }: { dateTime: string }) => (
    <span data-testid="date">{dateTime}</span>
  ),
}));

const createSummary = (
  overrides: Partial<ChangeProposalSummaryView> = {},
): ChangeProposalSummaryView => ({
  id: 'proposal-a',
  requester: { id: 'user-a', username: 'alice', name: 'Alice' },
  entry: 'mcp',
  createdAt: 'CREATED',
  status: 'applied',
  isRequester: false,
  pages: [],
  ...overrides,
});

describe('ChangeProposalSummaryItem', () => {
  it('shows requester, entry word, model name, date and overall status word', () => {
    render(
      <ChangeProposalSummaryItem
        proposal={createSummary({ modelLabel: 'model-y' })}
        dateTime="SHOWN-DATE"
      />,
    );
    expect(screen.getByText(/Alice/)).toBeTruthy();
    expect(screen.getByText('change_proposal_viewer.entry.mcp')).toBeTruthy();
    expect(screen.getByText('model-y')).toBeTruthy();
    expect(screen.getByTestId('date').textContent).toBe('SHOWN-DATE');
    expect(
      screen.getByText('change_proposal.proposal_status.applied'),
    ).toBeTruthy();
  });

  it('links the whole item to the detail page', () => {
    const { container } = render(
      <ChangeProposalSummaryItem proposal={createSummary()} dateTime="D" />,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/me/change-proposals/proposal-a',
    );
  });

  it('shows the path of a deleted page that core returned', () => {
    render(
      <ChangeProposalSummaryItem
        proposal={createSummary({
          pages: [{ id: 'page-a', path: '/gone/page' }],
        })}
        dateTime="D"
      />,
    );
    expect(screen.getByText('/gone/page')).toBeTruthy();
  });

  it('shows the page-gone text for a page without a path', () => {
    render(
      <ChangeProposalSummaryItem
        proposal={createSummary({ pages: [{ id: 'page-a' }] })}
        dateTime="D"
      />,
    );
    expect(
      screen.getByText('change_proposal_viewer.operation.page_gone'),
    ).toBeTruthy();
  });

  it('shows the first three paths and reveals the rest on request, without counts', () => {
    render(
      <ChangeProposalSummaryItem
        proposal={createSummary({
          pages: [
            { id: 'p-a', path: '/a' },
            { id: 'p-b', path: '/b' },
            { id: 'p-c', path: '/c' },
            { id: 'p-d', path: '/d' },
            { id: 'p-e', path: '/e' },
          ],
        })}
        dateTime="D"
      />,
    );
    expect(screen.getByText('/c')).toBeTruthy();
    expect(screen.queryByText('/d')).toBeNull();
    const more = screen.getByText(
      'change_proposal_viewer.list.show_more_pages',
    );
    expect(more.textContent).not.toMatch(/\d/);

    fireEvent.click(more);
    expect(screen.getByText('/d')).toBeTruthy();
    expect(screen.getByText('/e')).toBeTruthy();
    expect(
      screen.queryByText('change_proposal_viewer.list.show_more_pages'),
    ).toBeNull();
  });

  it('offers no show-more control for three paths or fewer', () => {
    render(
      <ChangeProposalSummaryItem
        proposal={createSummary({
          pages: [
            { id: 'p-a', path: '/a' },
            { id: 'p-b', path: '/b' },
            { id: 'p-c', path: '/c' },
          ],
        })}
        dateTime="D"
      />,
    );
    expect(
      screen.queryByText('change_proposal_viewer.list.show_more_pages'),
    ).toBeNull();
  });
});
