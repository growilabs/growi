import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { IPasswordHashUnmigratedUserList } from '~/interfaces/password-hash-migration';

import { UnmigratedUserList } from './UnmigratedUserList';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock('~/stores/admin/password-hash-unmigrated-users', () => ({
  useSWRxPasswordHashUnmigratedUsers: listMock,
}));

const K = 'security_settings.password_hash_migration';

const buildList = (
  overrides: Partial<IPasswordHashUnmigratedUserList> = {},
): IPasswordHashUnmigratedUserList => ({
  users: [
    {
      _id: 'u1',
      username: 'alice',
      email: 'alice@example.com',
      lastLoginAt: '2026-10-01T00:00:00.000Z',
      status: 2,
      hasExternalAccount: true,
    },
    {
      _id: 'u2',
      username: 'bob',
      email: null,
      lastLoginAt: null,
      status: 3,
      hasExternalAccount: false,
    },
  ],
  totalCount: 2,
  page: 1,
  limit: 20,
  ...overrides,
});

const mockList = (data: IPasswordHashUnmigratedUserList | undefined) => {
  listMock.mockReturnValue({
    data,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  });
};

const toggle = () => screen.getByRole('button', { name: `${K}.list_toggle` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UnmigratedUserList', () => {
  it('renders nothing when nobody is unmigrated', () => {
    mockList(undefined);

    const { container } = render(<UnmigratedUserList totalCount={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('does not fetch until the list is opened', () => {
    // The count alone answers the common case; the list costs a read per row.
    mockList(undefined);

    render(<UnmigratedUserList totalCount={2} />);

    expect(listMock).toHaveBeenCalledWith(1, false);
  });

  it('fetches and shows the rows once opened', async () => {
    const user = userEvent.setup();
    mockList(buildList());

    render(<UnmigratedUserList totalCount={2} />);
    await user.click(toggle());

    expect(listMock).toHaveBeenLastCalledWith(1, true);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('marks the signals that tell the admin whether prompting will help', async () => {
    const user = userEvent.setup();
    mockList(buildList());

    render(<UnmigratedUserList totalCount={2} />);
    await user.click(toggle());

    // alice: has an external account -> asking her to log in will not clear her.
    expect(
      screen.getByText(`${K}.list_has_external_account`),
    ).toBeInTheDocument();
    // bob: never logged in, and is not active.
    expect(screen.getByText(`${K}.list_never_logged_in`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.list_non_active`)).toBeInTheDocument();
  });

  it('surfaces a load failure instead of rendering an empty table', async () => {
    const user = userEvent.setup();
    listMock.mockReturnValue({
      data: undefined,
      error: new Error('boom'),
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<UnmigratedUserList totalCount={2} />);
    await user.click(toggle());

    expect(screen.getByText(`${K}.list_load_failed`)).toBeInTheDocument();
  });
});
