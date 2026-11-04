import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WipPageAlert } from './WipPageAlert';

const useIsReadOnlyUser = vi.hoisted(() => vi.fn().mockReturnValue(false));
const useCurrentPageData = vi.hoisted(() => vi.fn());
const useFetchCurrentPage = vi.hoisted(() =>
  vi.fn().mockReturnValue({ fetchCurrentPage: vi.fn() }),
);

vi.mock('~/states/context', () => ({
  useIsReadOnlyUser,
}));

vi.mock('~/states/page', () => ({
  useCurrentPageData,
  useFetchCurrentPage,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('WipPageAlert', () => {
  it('renders the publish alert when the page is WIP and the user is not read-only', () => {
    useIsReadOnlyUser.mockReturnValue(false);
    useCurrentPageData.mockReturnValue({ _id: 'page1', wip: true });

    render(<WipPageAlert />);

    expect(
      screen.getByRole('button', { name: 'wip_page.publish_page' }),
    ).toBeInTheDocument();
  });

  it('renders nothing when the page is not WIP', () => {
    useIsReadOnlyUser.mockReturnValue(false);
    useCurrentPageData.mockReturnValue({ _id: 'page1', wip: false });

    render(<WipPageAlert />);

    expect(
      screen.queryByRole('button', { name: 'wip_page.publish_page' }),
    ).not.toBeInTheDocument();
  });

  it('renders nothing for a read-only user, even when the page is WIP', () => {
    useIsReadOnlyUser.mockReturnValue(true);
    useCurrentPageData.mockReturnValue({ _id: 'page1', wip: true });

    render(<WipPageAlert />);

    // A read-only user can never successfully call the publish API
    // (excludeReadOnlyUser rejects it server-side), so the button
    // that would trigger it must not be shown at all.
    expect(
      screen.queryByRole('button', { name: 'wip_page.publish_page' }),
    ).not.toBeInTheDocument();
  });
});
