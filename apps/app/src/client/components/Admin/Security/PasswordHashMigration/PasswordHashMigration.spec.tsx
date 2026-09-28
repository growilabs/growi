import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { IResPasswordHashMigrationStatus } from '~/interfaces/password-hash-migration';

import { PasswordHashMigration } from './PasswordHashMigration';

// Translation keys are asserted directly, so `t` is the identity function.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

const { statusMock, cleanupMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  cleanupMock: vi.fn(),
}));

vi.mock('~/stores/admin/password-hash-migration', () => ({
  useSWRxPasswordHashMigrationStatus: statusMock,
  postPasswordHashCleanup: cleanupMock,
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const K = 'security_settings.password_hash_migration';

const buildStatus = (
  overrides: Partial<IResPasswordHashMigrationStatus['distribution']> = {},
  flags: Partial<Omit<IResPasswordHashMigrationStatus, 'distribution'>> = {},
): IResPasswordHashMigrationStatus => {
  const distribution = {
    upgradedOnly: 0,
    both: 0,
    legacyOnly: 0,
    legacyOnlyActive: 0,
    legacyOnlyNonActive: 0,
    noPassword: 0,
    ...overrides,
  };
  return {
    distribution,
    isCleanupRunnable: distribution.legacyOnlyActive === 0,
    isCleanupCompleted:
      distribution.both === 0 && distribution.legacyOnly === 0,
    ...flags,
  };
};

const mockStatus = (data: IResPasswordHashMigrationStatus | undefined) => {
  statusMock.mockReturnValue({
    data,
    error: undefined,
    isLoading: data == null,
    mutate: vi.fn(),
  });
};

const cleanupButton = () => screen.getByRole('button', { name: K_BUTTON });
const K_BUTTON = `${K}.cleanup_button`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PasswordHashMigration', () => {
  it('refuses to offer the cleanup while an ACTIVE user is still unmigrated', () => {
    // The button is the only thing standing between an admin and a destructive,
    // irreversible operation the server would refuse anyway — it must be disabled,
    // and the reason must be visible.
    mockStatus(buildStatus({ both: 4, legacyOnly: 2, legacyOnlyActive: 2 }));

    render(<PasswordHashMigration />);

    expect(cleanupButton()).toBeDisabled();
    expect(screen.getByText(`${K}.blocked`)).toBeInTheDocument();
  });

  it('offers the cleanup once no ACTIVE user is left unmigrated', () => {
    mockStatus(
      buildStatus({
        both: 4,
        legacyOnly: 3,
        legacyOnlyActive: 0,
        legacyOnlyNonActive: 3,
      }),
    );

    render(<PasswordHashMigration />);

    expect(cleanupButton()).toBeEnabled();
    expect(screen.getByText(`${K}.ready_to_cleanup`)).toBeInTheDocument();
    // Non-active stragglers are surfaced but explicitly do not block.
    expect(screen.getByText(`${K}.non_active_note`)).toBeInTheDocument();
  });

  it('reports completion and offers nothing once no legacy hash remains', () => {
    mockStatus(buildStatus({ upgradedOnly: 7, both: 0 }));

    render(<PasswordHashMigration />);

    expect(cleanupButton()).toBeDisabled();
    expect(screen.getByText(`${K}.already_completed`)).toBeInTheDocument();
  });

  it('does not claim completion when nobody has migrated yet', () => {
    // Regression: with no migrated users at all there is nothing for the cleanup
    // to remove, which previously rendered as "already complete" even though every
    // stored credential was still old-format.
    mockStatus(buildStatus({ legacyOnly: 5, legacyOnlyActive: 5 }));

    render(<PasswordHashMigration />);

    expect(
      screen.queryByText(`${K}.already_completed`),
    ).not.toBeInTheDocument();
    expect(screen.getByText(`${K}.blocked`)).toBeInTheDocument();
    expect(cleanupButton()).toBeDisabled();
  });

  it('says there is nothing to remove when only non-active users are unmigrated', () => {
    // Not blocked and nothing to delete, but old-format data is still stored, so
    // this is neither "ready" nor "complete".
    mockStatus(
      buildStatus({
        legacyOnly: 3,
        legacyOnlyActive: 0,
        legacyOnlyNonActive: 3,
      }),
    );

    render(<PasswordHashMigration />);

    expect(screen.getByText(`${K}.nothing_to_remove`)).toBeInTheDocument();
    expect(
      screen.queryByText(`${K}.already_completed`),
    ).not.toBeInTheDocument();
    expect(cleanupButton()).toBeDisabled();
  });

  it('does not run the cleanup until the irreversibility is acknowledged', async () => {
    const user = userEvent.setup();
    mockStatus(buildStatus({ both: 4 }));

    render(<PasswordHashMigration />);
    await user.click(cleanupButton());

    const execute = screen.getByRole('button', {
      name: `${K}.cleanup_execute`,
    });
    expect(execute).toBeDisabled();
    expect(cleanupMock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('checkbox', { name: `${K}.cleanup_consent` }),
    );
    expect(execute).toBeEnabled();
  });

  it('runs the cleanup after the acknowledgement is given', async () => {
    const user = userEvent.setup();
    cleanupMock.mockResolvedValue({ unset: 4 });
    mockStatus(buildStatus({ both: 4 }));

    render(<PasswordHashMigration />);
    await user.click(cleanupButton());
    await user.click(
      screen.getByRole('checkbox', { name: `${K}.cleanup_consent` }),
    );
    await user.click(
      screen.getByRole('button', { name: `${K}.cleanup_execute` }),
    );

    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });
});
