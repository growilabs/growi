// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const Wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
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

  describe('pagination', () => {
    it('requests the next page and shows its rows when page 2 is clicked', async () => {
      const page1 = Array.from({ length: 20 }, (_, i) =>
        userOf({ username: `first-${i}` }),
      );
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
      renderList();
      await screen.findByRole('row', { name: /first-0/ });

      await userEvent.click(screen.getByText('2'));

      expect(await screen.findByRole('row', { name: /second-0/ })).toBeTruthy();
      expect(apiv3Get).toHaveBeenCalledWith(
        ENDPOINT,
        expect.objectContaining({ page: 2 }),
      );
    });

    it('shows no pagination when everything fits on one page', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(
        mockResponse(responseOf([userOf({ username: 'dave' })])),
      );
      renderList();
      await screen.findByRole('row', { name: /dave/ });

      expect(screen.queryByRole('navigation')).toBeNull();
    });
  });

  describe('empty and error states', () => {
    it('shows the empty message and no table when there is nobody to nudge', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(mockResponse(responseOf([])));
      renderList();

      expect(await screen.findByText(`${PREFIX}.empty`)).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('shows the error message and no table when the fetch fails', async () => {
      vi.mocked(apiv3Get).mockRejectedValue(new Error('boom'));
      renderList();

      expect(await screen.findByText(`${PREFIX}.fetch_error`)).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('shows the error message when the response has no users', async () => {
      vi.mocked(apiv3Get).mockResolvedValue(mockResponse('<html>login</html>'));
      renderList();

      expect(await screen.findByText(`${PREFIX}.fetch_error`)).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
    });
  });
});
