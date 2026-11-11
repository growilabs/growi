import { render, screen } from '@testing-library/react';

import { ActivityLogActions, type IUserActivity } from '~/interfaces/activity';

import { ActivityListItem } from './ActivityListItem';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

// The wire value of createdAt is an ISO string even though the type says Date
const buildActivity = (createdAt: string): IUserActivity =>
  JSON.parse(
    JSON.stringify({
      _id: 'activity-1',
      action: ActivityLogActions.ACTION_PAGE_CREATE,
      createdAt,
      user: {
        _id: 'user-1',
        username: 'alice',
        name: 'Alice',
        imageUrlCached: '/images/alice.png',
      },
      target: { _id: 'page-1', path: '/team/notes' },
    }),
  );

describe('ActivityListItem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T11:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the page path as a link to that page', () => {
    render(
      <ActivityListItem
        props={{ activity: buildActivity('2026-11-11T09:00:00.000Z') }}
      />,
    );

    const link = screen.getByRole('link', { name: '/team/notes' });
    expect(link.getAttribute('href')).toBe('/team/notes');
  });

  it('shows the action label and the elapsed time from an ISO string createdAt', () => {
    render(
      <ActivityListItem
        props={{ activity: buildActivity('2026-11-11T09:00:00.000Z') }}
      />,
    );

    expect(screen.getByText('user_home_page.page_create')).toBeTruthy();
    expect(screen.getByText('about 2 hours ago')).toBeTruthy();
  });
});
