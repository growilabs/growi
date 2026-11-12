import { render, screen } from '@testing-library/react';
import type { SWRResponse } from 'swr';
import { mock } from 'vitest-mock-extended';

import {
  ActivityLogActions,
  type IUserActivity,
  type UserActivitiesResult,
} from '~/interfaces/activity';
import { useSWRxRecentActivity } from '~/stores/recent-activity';

import { RecentActivity } from './RecentActivity';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

vi.mock('~/client/util/toastr', () => ({ toastError: vi.fn() }));

vi.mock('~/stores/recent-activity', () => ({
  useSWRxRecentActivity: vi.fn(),
}));

type Result = UserActivitiesResult['serializedPaginationResult'];

const buildRow = (index: number): IUserActivity => ({
  _id: `activity-${index}`,
  action: ActivityLogActions.ACTION_PAGE_UPDATE,
  createdAt: '2026-11-11T09:00:00.000Z',
  user: {
    _id: 'user-1',
    username: 'alice',
    name: 'Alice',
    imageUrlCached: '/images/alice.png',
  },
  target: { _id: `page-${index}`, path: `/page-${index}` },
});

const mockResponse = (rowCount: number, totalDocs: number): void => {
  const data: Result = {
    docs: Array.from({ length: rowCount }, (_, i) => buildRow(i)),
    totalDocs,
    limit: 10,
    offset: 0,
    page: 1,
    totalPages: Math.ceil(totalDocs / 10),
    hasNextPage: totalDocs > 10,
    hasPrevPage: false,
    nextPage: totalDocs > 10 ? 2 : null,
    prevPage: null,
    pagingCounter: 1,
  };
  vi.mocked(useSWRxRecentActivity).mockReturnValue(
    mock<SWRResponse<Result, Error>>({ data, error: undefined }),
  );
};

describe('RecentActivity', () => {
  it('renders one row per response row, each with a link to its page', () => {
    mockResponse(7, 7);

    render(<RecentActivity userId="user-1" />);

    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(
      screen.getByRole('link', { name: '/page-3' }).getAttribute('href'),
    ).toBe('/page-3');
  });

  it('derives the number of pages from the total count', () => {
    mockResponse(10, 25);

    render(<RecentActivity userId="user-1" />);

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.queryByText('4')).toBeNull();
  });

  it('shows no pagination when the total count fits in one page', () => {
    mockResponse(3, 3);

    render(<RecentActivity userId="user-1" />);

    expect(screen.queryByText('2')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
