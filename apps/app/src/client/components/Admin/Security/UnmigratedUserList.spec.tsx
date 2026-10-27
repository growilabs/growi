// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
// biome-ignore lint/style/noRestrictedImports: import only types
import type { AxiosResponse } from 'axios';
import { SWRConfig } from 'swr';
import { mock } from 'vitest-mock-extended';

import { apiv3Get } from '~/client/util/apiv3-client';
import type {
  PasswordHashUnmigratedUser,
  PasswordHashUnmigratedUsersResponse,
} from '~/interfaces/password-hash-status';

import { UnmigratedUserList } from './UnmigratedUserList';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: vi.fn(),
}));

const PREFIX = 'security_settings.legacy_password_cleanup.unmigrated_list';
const RETRY_LABEL = 'security_settings.legacy_password_cleanup.retry';
const ENDPOINT = '/security-setting/password-hash-unmigrated-users';

const userOf = (
  overrides: Partial<PasswordHashUnmigratedUser> & { username: string },
): PasswordHashUnmigratedUser => ({
  _id: `id-${overrides.username}`,
  email: `${overrides.username}@example.com`,
  lastLoginAt: null,
  ...overrides,
});

const responseOf = (
  users: PasswordHashUnmigratedUser[],
  overrides: Partial<PasswordHashUnmigratedUsersResponse> = {},
): PasswordHashUnmigratedUsersResponse => ({
  users,
  totalCount: users.length,
  page: 1,
  limit: 20,
  ...overrides,
});

const mockResponse = (data: unknown) => mock<AxiosResponse>({ data });

// happy-dom never reports intersections, so the list's InfiniteScroll gets an
// observer double whose callback the test fires to simulate scrolling to the
// end of the scroll box.
const observerCallbacks: IntersectionObserverCallback[] = [];

class IntersectionObserverDouble implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];

  constructor(callback: IntersectionObserverCallback) {
    observerCallbacks.push(callback);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const scrollToEnd = () =>
  act(() => {
    const entry = mock<IntersectionObserverEntry>({ isIntersecting: true });
    // Snapshot first: constructing the observer argument registers a callback.
    const callbacks = [...observerCallbacks];
    const observer = new IntersectionObserverDouble(() => {});
    for (const callback of callbacks) {
      callback([entry], observer);
    }
  });

beforeEach(() => {
  // A test that stops before consuming every mockResolvedValueOnce would
  // otherwise leak the leftover pages into the next test.
  vi.mocked(apiv3Get).mockReset();
  observerCallbacks.length = 0;
  vi.stubGlobal('IntersectionObserver', IntersectionObserverDouble);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// SWR's automatic error retry fires on a randomized multi-second backoff; it is
// turned off so a test only sees the requests the user's actions trigger.
const Wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig
    value={{
      provider: () => new Map(),
      dedupingInterval: 0,
      shouldRetryOnError: false,
    }}
  >
    {children}
  </SWRConfig>
);

const renderList = () => render(<UnmigratedUserList />, { wrapper: Wrapper });

describe('UnmigratedUserList', () => {
  describe('rows', () => {
    it('shows username, email and the formatted last login of each user', async () => {
      const lastLogin = new Date(2026, 0, 5, 9, 30);
      vi.mocked(apiv3Get).mockResolvedValue(
        mockResponse(
          responseOf([
            userOf({
              username: 'alice',
              lastLoginAt: lastLogin.toISOString(),
            }),
          ]),
        ),
      );
      renderList();

      const row = await screen.findByRole('row', { name: /alice/ });
      expect(within(row).getByText('alice@example.com')).toBeTruthy();
      expect(within(row).getByText('2026-01-05 09:30')).toBeTruthy();
    });

    it('shows the never-logged-in text when the user has never logged in', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(
        mockResponse(responseOf([userOf({ username: 'bob' })])),
      );
      renderList();

      const row = await screen.findByRole('row', { name: /bob/ });
      expect(within(row).getByText(`${PREFIX}.never_logged_in`)).toBeTruthy();
    });

    it('still lists a user without an email', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(
        mockResponse(responseOf([userOf({ username: 'carol', email: null })])),
      );
      renderList();

      expect(await screen.findByRole('row', { name: /carol/ })).toBeTruthy();
    });
  });

  describe('infinite scroll', () => {
    const page1 = Array.from({ length: 20 }, (_, i) =>
      userOf({ username: `first-${i}` }),
    );

    const mockTwoPages = () => {
      vi.mocked(apiv3Get)
        .mockResolvedValueOnce(
          mockResponse(responseOf(page1, { totalCount: 21, page: 1 })),
        )
        .mockResolvedValueOnce(
          mockResponse(
            responseOf([userOf({ username: 'second-0' })], {
              totalCount: 21,
              page: 2,
            }),
          ),
        );
    };

    it('shows the first 20 rows and requests only the first page', async () => {
      mockTwoPages();
      renderList();

      expect(await screen.findByRole('row', { name: /first-19/ })).toBeTruthy();
      // 20 body rows plus the header row
      expect(screen.getAllByRole('row')).toHaveLength(21);
      expect(apiv3Get).toHaveBeenCalledTimes(1);
      expect(apiv3Get).toHaveBeenCalledWith(ENDPOINT, { page: 1, limit: 20 });
    });

    it('requests the next page and appends its rows when the end of the list is reached', async () => {
      mockTwoPages();
      renderList();
      await screen.findByRole('row', { name: /first-19/ });

      await scrollToEnd();

      expect(await screen.findByRole('row', { name: /second-0/ })).toBeTruthy();
      expect(screen.getByRole('row', { name: /first-0/ })).toBeTruthy();
      expect(apiv3Get).toHaveBeenCalledWith(ENDPOINT, { page: 2, limit: 20 });
    });

    it('does not request another page once every user is listed', async () => {
      mockTwoPages();
      renderList();
      await screen.findByRole('row', { name: /first-19/ });
      await scrollToEnd();
      await screen.findByRole('row', { name: /second-0/ });

      await scrollToEnd();

      await waitFor(() => expect(apiv3Get).toHaveBeenCalledTimes(2));
      expect(apiv3Get).not.toHaveBeenCalledWith(
        ENDPOINT,
        expect.objectContaining({ page: 3 }),
      );
    });

    it('stops loading when a later page reports a smaller total than the first', {
      timeout: 3000,
    }, async () => {
      // A user migrates mid-scroll: page 1 still says 21, page 2 says 20.
      vi.mocked(apiv3Get)
        .mockResolvedValueOnce(
          mockResponse(responseOf(page1, { totalCount: 21, page: 1 })),
        )
        .mockResolvedValueOnce(
          mockResponse(responseOf([], { totalCount: 20, page: 2 })),
        );
      renderList();
      await screen.findByRole('row', { name: /first-19/ });

      await scrollToEnd();
      await waitFor(() => expect(apiv3Get).toHaveBeenCalledTimes(2));
      await scrollToEnd();

      expect(apiv3Get).toHaveBeenCalledTimes(2);
      expect(screen.getAllByRole('row')).toHaveLength(21);
    });

    it('does not request a second page when the first page holds exactly every user', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(
        mockResponse(responseOf(page1, { totalCount: 20, page: 1 })),
      );
      renderList();
      await screen.findByRole('row', { name: /first-19/ });

      await scrollToEnd();

      expect(apiv3Get).toHaveBeenCalledTimes(1);
    });

    it('does not request a second page when everything fits on the first', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(
        mockResponse(responseOf([userOf({ username: 'dave' })])),
      );
      renderList();
      await screen.findByRole('row', { name: /dave/ });

      await scrollToEnd();

      expect(apiv3Get).toHaveBeenCalledTimes(1);
    });
  });

  describe('when loading a later page fails', () => {
    const page1 = Array.from({ length: 20 }, (_, i) =>
      userOf({ username: `first-${i}` }),
    );

    const failSecondPage = async () => {
      vi.mocked(apiv3Get)
        .mockResolvedValueOnce(
          mockResponse(responseOf(page1, { totalCount: 21, page: 1 })),
        )
        .mockRejectedValueOnce(new Error('boom'));
      renderList();
      await screen.findByRole('row', { name: /first-19/ });
      await scrollToEnd();
      await screen.findByText(`${PREFIX}.load_more_error`);
    };

    it('keeps the loaded rows and shows the load-more error with a retry button', async () => {
      await failSecondPage();

      expect(screen.getByRole('row', { name: /first-0/ })).toBeTruthy();
      expect(screen.getByRole('row', { name: /first-19/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: RETRY_LABEL })).toBeTruthy();
      expect(screen.queryByText(`${PREFIX}.fetch_error`)).toBeNull();
    });

    it('does not keep loading more while the error is shown', async () => {
      await failSecondPage();
      expect(apiv3Get).toHaveBeenCalledTimes(2);

      await scrollToEnd();

      expect(apiv3Get).toHaveBeenCalledTimes(2);
      expect(screen.getByText(`${PREFIX}.load_more_error`)).toBeTruthy();
    });

    it('requests the failed page again on retry and appends its rows', async () => {
      await failSecondPage();
      vi.mocked(apiv3Get).mockResolvedValueOnce(
        mockResponse(
          responseOf([userOf({ username: 'second-0' })], {
            totalCount: 21,
            page: 2,
          }),
        ),
      );

      fireEvent.click(screen.getByRole('button', { name: RETRY_LABEL }));

      expect(await screen.findByRole('row', { name: /second-0/ })).toBeTruthy();
      expect(screen.getByRole('row', { name: /first-0/ })).toBeTruthy();
      expect(screen.queryByText(`${PREFIX}.load_more_error`)).toBeNull();
      expect(screen.queryByRole('button', { name: RETRY_LABEL })).toBeNull();
      expect(apiv3Get).toHaveBeenCalledTimes(3);
      expect(apiv3Get).toHaveBeenLastCalledWith(ENDPOINT, {
        page: 2,
        limit: 20,
      });
    });
  });

  describe('empty and error states', () => {
    it('shows the empty message and no table when there is nobody to nudge', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(mockResponse(responseOf([])));
      renderList();

      expect(await screen.findByText(`${PREFIX}.empty`)).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('shows the error message with a retry button and no table when the fetch fails', async () => {
      vi.mocked(apiv3Get).mockRejectedValue(new Error('boom'));
      renderList();

      expect(await screen.findByText(`${PREFIX}.fetch_error`)).toBeTruthy();
      expect(screen.getByRole('button', { name: RETRY_LABEL })).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByText(`${PREFIX}.load_more_error`)).toBeNull();
    });

    it('requests the first page again on retry and shows its rows', async () => {
      vi.mocked(apiv3Get)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(
          mockResponse(responseOf([userOf({ username: 'erin' })])),
        );
      renderList();
      await screen.findByText(`${PREFIX}.fetch_error`);

      fireEvent.click(screen.getByRole('button', { name: RETRY_LABEL }));

      expect(await screen.findByRole('row', { name: /erin/ })).toBeTruthy();
      expect(screen.queryByText(`${PREFIX}.fetch_error`)).toBeNull();
      expect(screen.queryByRole('button', { name: RETRY_LABEL })).toBeNull();
      expect(apiv3Get).toHaveBeenCalledTimes(2);
      expect(apiv3Get).toHaveBeenLastCalledWith(ENDPOINT, {
        page: 1,
        limit: 20,
      });
    });

    it('shows the error message when the response has no users', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(mockResponse('<html>login</html>'));
      renderList();

      expect(await screen.findByText(`${PREFIX}.fetch_error`)).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
    });
  });
  describe('when mounted again', () => {
    it('refetches the cached list and drops users who migrated meanwhile', async () => {
      vi.mocked(apiv3Get)
        .mockResolvedValueOnce(
          mockResponse(
            responseOf([
              userOf({ username: 'alice' }),
              userOf({ username: 'bob' }),
            ]),
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(responseOf([userOf({ username: 'bob' })])),
        );
      // Same Wrapper, so the SWR cache survives the remount.
      const { rerender } = render(<UnmigratedUserList key="first" />, {
        wrapper: Wrapper,
      });
      await screen.findByRole('row', { name: /alice/ });

      rerender(<UnmigratedUserList key="second" />);

      await waitFor(() =>
        expect(screen.queryByRole('row', { name: /alice/ })).toBeNull(),
      );
      expect(screen.getByRole('row', { name: /bob/ })).toBeTruthy();
      expect(apiv3Get).toHaveBeenCalledTimes(2);
    });
  });
});
