// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// biome-ignore lint/style/noRestrictedImports: import only types
import type { AxiosResponse } from 'axios';
import { SWRConfig } from 'swr';
import { mock } from 'vitest-mock-extended';

import { apiv3Delete, apiv3Get } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { PasswordHashFormatCounts } from '~/interfaces/password-hash-status';

import { LegacyPasswordCleanupSetting } from './LegacyPasswordCleanupSetting';

// `t` returns the key verbatim, with the interpolated count appended so that
// count-bearing messages can be asserted.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count != null ? `${key} [${options.count}]` : key,
  }),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: vi.fn(),
  apiv3Delete: vi.fn(),
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const PREFIX = 'security_settings.legacy_password_cleanup';

const countsOf = (
  overrides: Partial<PasswordHashFormatCounts> = {},
): PasswordHashFormatCounts => ({
  upgradedOnly: 11,
  both: 3,
  legacyOnly: { active: 5, nonActive: 7 },
  noPassword: 2,
  ...overrides,
});

const Wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const renderSection = () =>
  render(<LegacyPasswordCleanupSetting />, { wrapper: Wrapper });

const STATUS_ENDPOINT = '/security-setting/password-hash-status';

const emptyUnmigratedUsers = {
  users: [],
  totalCount: 0,
  page: 1,
  limit: 20,
};

// apiv3Get is shared by the status hook and the unmigrated-user list, so the
// mock is routed by endpoint. `getData` is evaluated per call so that a test
// can change what a refetch returns.
const mockStatus = (getData: unknown | (() => unknown)) => {
  vi.mocked(apiv3Get).mockImplementation((endpoint: string) => {
    const data =
      endpoint === STATUS_ENDPOINT
        ? typeof getData === 'function'
          ? getData()
          : getData
        : emptyUnmigratedUsers;
    return Promise.resolve(mock<AxiosResponse>({ data }));
  });
};

const failStatus = () => {
  vi.mocked(apiv3Get).mockImplementation((endpoint: string) =>
    endpoint === STATUS_ENDPOINT
      ? Promise.reject(new Error('boom'))
      : Promise.resolve(mock<AxiosResponse>({ data: emptyUnmigratedUsers })),
  );
};

const deleteButton = () =>
  screen.getByRole('button', { name: `${PREFIX}.delete_button` });

describe('LegacyPasswordCleanupSetting', () => {
  describe('count table', () => {
    it('shows the count of every category and the legacy-only breakdown', async () => {
      mockStatus({ counts: countsOf() });
      renderSection();

      const row = (label: string) =>
        screen.findByRole('row', { name: new RegExp(`${label}`) });

      expect(
        within(await row(`${PREFIX}.count_label.upgraded_only`)).getByText(
          '11',
        ),
      ).toBeTruthy();
      expect(
        within(await row(`${PREFIX}.count_label.both`)).getByText('3'),
      ).toBeTruthy();
      expect(
        within(await row(`${PREFIX}.count_label.legacy_only_active`)).getByText(
          '5',
        ),
      ).toBeTruthy();
      expect(
        within(
          await row(`${PREFIX}.count_label.legacy_only_non_active`),
        ).getByText('7'),
      ).toBeTruthy();
      expect(
        within(await row(`${PREFIX}.count_label.no_password`)).getByText('2'),
      ).toBeTruthy();
      expect(screen.getByText(`${PREFIX}.both_is_target_hint`)).toBeTruthy();
    });
  });

  describe('delete button availability', () => {
    it('is enabled when there are users to clean up', async () => {
      mockStatus({ counts: countsOf() });
      renderSection();

      await screen.findByText(`${PREFIX}.count_label.both`);
      expect(deleteButton().hasAttribute('disabled')).toBe(false);
    });

    it('is disabled when no user has both formats', async () => {
      mockStatus({ counts: countsOf({ both: 0 }) });
      renderSection();

      await screen.findByText(`${PREFIX}.count_label.both`);
      expect(deleteButton().hasAttribute('disabled')).toBe(true);
    });

    it('is disabled and shows an error message when the fetch fails', async () => {
      failStatus();
      renderSection();

      expect(await screen.findByText(`${PREFIX}.fetch_error`)).toBeTruthy();
      expect(deleteButton().hasAttribute('disabled')).toBe(true);
    });

    it('is disabled and shows an error message when the response has no counts', async () => {
      mockStatus('<html>login</html>');
      renderSection();

      expect(await screen.findByText(`${PREFIX}.fetch_error`)).toBeTruthy();
      expect(deleteButton().hasAttribute('disabled')).toBe(true);
    });

    it('fetches the counts again on retry and then enables the button', async () => {
      failStatus();
      renderSection();
      await screen.findByText(`${PREFIX}.fetch_error`);

      mockStatus({ counts: countsOf() });
      await userEvent.click(
        screen.getByRole('button', { name: `${PREFIX}.retry` }),
      );

      expect(
        await screen.findByText(`${PREFIX}.count_label.both`),
      ).toBeTruthy();
      expect(screen.queryByText(`${PREFIX}.fetch_error`)).toBeNull();
      expect(deleteButton().hasAttribute('disabled')).toBe(false);
    });

    it('refetches the counts when the section is mounted again', async () => {
      let counts = countsOf();
      mockStatus(() => ({ counts }));
      // Same Wrapper, so the SWR cache survives the remount.
      const { rerender } = render(
        <LegacyPasswordCleanupSetting key="first" />,
        {
          wrapper: Wrapper,
        },
      );
      await screen.findByText(`${PREFIX}.count_label.both`);

      counts = countsOf({ both: 0 });
      rerender(<LegacyPasswordCleanupSetting key="second" />);

      await waitFor(() =>
        expect(deleteButton().hasAttribute('disabled')).toBe(true),
      );
    });
  });

  describe('section visibility', () => {
    const heading = () => screen.queryByText(`${PREFIX}.title`);
    const zeroLegacy = { active: 0, nonActive: 0 };

    it('renders nothing while the status is loading', () => {
      vi.mocked(apiv3Get).mockReturnValue(new Promise(() => {}));
      const { container } = renderSection();

      expect(container.textContent).toBe('');
    });

    it('is hidden when no user has a legacy password', async () => {
      mockStatus({
        counts: countsOf({ both: 0, legacyOnly: zeroLegacy }),
      });
      const { container } = renderSection();

      await waitFor(() =>
        expect(vi.mocked(apiv3Get)).toHaveBeenCalledWith(STATUS_ENDPOINT),
      );
      await waitFor(() => expect(container.textContent).toBe(''));
      expect(heading()).toBeNull();
    });

    it('is shown when only users with both formats remain', async () => {
      mockStatus({
        counts: countsOf({ both: 4, legacyOnly: zeroLegacy }),
      });
      renderSection();

      expect(await screen.findByText(`${PREFIX}.title`)).toBeTruthy();
    });

    it('is shown when only legacy-only users remain', async () => {
      mockStatus({
        counts: countsOf({ both: 0, legacyOnly: { active: 0, nonActive: 2 } }),
      });
      renderSection();

      expect(await screen.findByText(`${PREFIX}.title`)).toBeTruthy();
    });

    it('is shown with the error message when the fetch fails', async () => {
      failStatus();
      renderSection();

      expect(await screen.findByText(`${PREFIX}.title`)).toBeTruthy();
      expect(screen.getByText(`${PREFIX}.fetch_error`)).toBeTruthy();
    });

    it('includes the unmigrated user list', async () => {
      mockStatus({ counts: countsOf() });
      renderSection();

      expect(
        await screen.findByText(`${PREFIX}.unmigrated_list.title`),
      ).toBeTruthy();
    });
  });

  describe('confirmation modal', () => {
    it('shows the target count and the downgrade warning', async () => {
      mockStatus({ counts: countsOf() });
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);

      await userEvent.click(deleteButton());

      expect(await screen.findByText(`${PREFIX}.confirm.title`)).toBeTruthy();
      expect(
        screen.getByText(new RegExp(`${PREFIX}.confirm.warning \\[3\\]`)),
      ).toBeTruthy();
      expect(
        screen.getByText(new RegExp(`${PREFIX}.confirm.downgrade_warning`)),
      ).toBeTruthy();
    });

    it('shows the latest target count refetched on click', async () => {
      let statusFetches = 0;
      mockStatus(() => {
        statusFetches += 1;
        return { counts: countsOf({ both: statusFetches === 1 ? 3 : 43 }) };
      });
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);

      await userEvent.click(deleteButton());

      expect(
        await screen.findByText(
          new RegExp(`${PREFIX}.confirm.warning \\[43\\]`),
        ),
      ).toBeTruthy();
    });

    it('does not open when the refetched target count is zero', async () => {
      let statusFetches = 0;
      mockStatus(() => {
        statusFetches += 1;
        return { counts: countsOf({ both: statusFetches === 1 ? 3 : 0 }) };
      });
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);

      await userEvent.click(deleteButton());

      // The refetched zero disables the button; the modal must stay closed.
      await waitFor(() =>
        expect(deleteButton().hasAttribute('disabled')).toBe(true),
      );
      expect(screen.queryByText(`${PREFIX}.confirm.title`)).toBeNull();
    });

    it('does not open and reports an error when the refetch on click fails', async () => {
      let statusFetches = 0;
      vi.mocked(apiv3Get).mockImplementation((endpoint: string) => {
        if (endpoint !== STATUS_ENDPOINT) {
          return Promise.resolve(
            mock<AxiosResponse>({ data: emptyUnmigratedUsers }),
          );
        }
        statusFetches += 1;
        return statusFetches === 1
          ? Promise.resolve(
              mock<AxiosResponse>({ data: { counts: countsOf() } }),
            )
          : Promise.reject(new Error('boom'));
      });
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);

      await userEvent.click(deleteButton());

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(`${PREFIX}.fetch_error`),
      );
      expect(screen.queryByText(`${PREFIX}.confirm.title`)).toBeNull();
      await waitFor(() =>
        expect(deleteButton().hasAttribute('disabled')).toBe(false),
      );
    });

    it('opens only after the refetch on click has finished', async () => {
      let statusFetches = 0;
      let resolveRefetch: (res: AxiosResponse) => void = () => {};
      vi.mocked(apiv3Get).mockImplementation((endpoint: string) => {
        if (endpoint !== STATUS_ENDPOINT) {
          return Promise.resolve(
            mock<AxiosResponse>({ data: emptyUnmigratedUsers }),
          );
        }
        statusFetches += 1;
        return statusFetches === 1
          ? Promise.resolve(
              mock<AxiosResponse>({ data: { counts: countsOf() } }),
            )
          : new Promise<AxiosResponse>((resolve) => {
              resolveRefetch = resolve;
            });
      });
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);

      await userEvent.click(deleteButton());

      await waitFor(() => expect(statusFetches).toBe(2));
      expect(screen.queryByText(`${PREFIX}.confirm.title`)).toBeNull();
      expect(deleteButton().hasAttribute('disabled')).toBe(true);

      resolveRefetch(
        mock<AxiosResponse>({ data: { counts: countsOf({ both: 8 }) } }),
      );

      expect(
        await screen.findByText(
          new RegExp(`${PREFIX}.confirm.warning \\[8\\]`),
        ),
      ).toBeTruthy();
    });

    it('does nothing when cancelled', async () => {
      mockStatus({ counts: countsOf() });
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);
      await userEvent.click(deleteButton());
      await screen.findByText(`${PREFIX}.confirm.title`);

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByText(`${PREFIX}.confirm.title`)).toBeNull(),
      );
      expect(apiv3Delete).not.toHaveBeenCalled();
      expect(deleteButton().hasAttribute('disabled')).toBe(false);
    });
  });

  describe('deletion', () => {
    const confirmDeletion = async () => {
      await screen.findByText(`${PREFIX}.count_label.both`);
      await userEvent.click(deleteButton());
      await userEvent.click(
        await screen.findByRole('button', {
          name: `${PREFIX}.confirm.submit`,
        }),
      );
    };

    it('closes the modal, reports the deleted count and refetches on success', async () => {
      mockStatus({ counts: countsOf() });
      vi.mocked(apiv3Delete).mockResolvedValue(
        mock<AxiosResponse>({ data: { unsetCount: 3 } }),
      );
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);
      const fetchesBefore = vi.mocked(apiv3Get).mock.calls.length;

      await confirmDeletion();

      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith(`${PREFIX}.success [3]`),
      );
      expect(toastError).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByText(`${PREFIX}.confirm.title`)).toBeNull(),
      );
      await waitFor(() =>
        expect(vi.mocked(apiv3Get).mock.calls.length).toBeGreaterThan(
          fetchesBefore,
        ),
      );
    });

    it('reports success and then hides the section once nothing legacy remains', async () => {
      let counts = countsOf({ legacyOnly: { active: 0, nonActive: 0 } });
      mockStatus(() => ({ counts }));
      vi.mocked(apiv3Delete).mockImplementation(() => {
        counts = countsOf({
          both: 0,
          upgradedOnly: 14,
          legacyOnly: { active: 0, nonActive: 0 },
        });
        return Promise.resolve(
          mock<AxiosResponse>({ data: { unsetCount: 3 } }),
        );
      });
      renderSection();

      await confirmDeletion();

      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith(`${PREFIX}.success [3]`),
      );
      await waitFor(() =>
        expect(screen.queryByText(`${PREFIX}.title`)).toBeNull(),
      );
    });

    it('sends a single delete request when the confirm button is clicked twice', async () => {
      mockStatus({ counts: countsOf() });
      vi.mocked(apiv3Delete).mockResolvedValue(
        mock<AxiosResponse>({ data: { unsetCount: 3 } }),
      );
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);
      await userEvent.click(deleteButton());
      const submit = await screen.findByRole('button', {
        name: `${PREFIX}.confirm.submit`,
      });

      // The modal fades out after the first click, leaving the button
      // clickable for a moment.
      fireEvent.click(submit);
      fireEvent.click(submit);

      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith(`${PREFIX}.success [3]`),
      );
      expect(apiv3Delete).toHaveBeenCalledTimes(1);
      expect(toastSuccess).toHaveBeenCalledTimes(1);
    });

    it('disables the delete button until the deletion finishes', async () => {
      mockStatus({ counts: countsOf() });
      let resolveDelete: (res: AxiosResponse) => void = () => {};
      vi.mocked(apiv3Delete).mockReturnValue(
        new Promise<AxiosResponse>((resolve) => {
          resolveDelete = resolve;
        }),
      );
      renderSection();

      await confirmDeletion();

      await waitFor(() =>
        expect(deleteButton().hasAttribute('disabled')).toBe(true),
      );

      resolveDelete(mock<AxiosResponse>({ data: { unsetCount: 3 } }));

      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith(`${PREFIX}.success [3]`),
      );
      await waitFor(() =>
        expect(deleteButton().hasAttribute('disabled')).toBe(false),
      );
    });

    it('shows an error toast, no success toast, and refetches on failure', async () => {
      mockStatus({ counts: countsOf() });
      vi.mocked(apiv3Delete).mockRejectedValue(new Error('boom'));
      renderSection();
      await screen.findByText(`${PREFIX}.count_label.both`);
      const fetchesBefore = vi.mocked(apiv3Get).mock.calls.length;

      await confirmDeletion();

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(`${PREFIX}.delete_error`),
      );
      expect(toastSuccess).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(vi.mocked(apiv3Get).mock.calls.length).toBeGreaterThan(
          fetchesBefore,
        ),
      );
    });

    it('treats a response without unsetCount as a failure', async () => {
      mockStatus({ counts: countsOf() });
      vi.mocked(apiv3Delete).mockResolvedValue(
        mock<AxiosResponse>({ data: '<html></html>' }),
      );
      renderSection();

      await confirmDeletion();

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(`${PREFIX}.delete_error`),
      );
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });
});
