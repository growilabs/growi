import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchUsernameTypeahead } from './SearchUsernameTypeahead';

const mockUseSWRxAuditlogSuggestions = vi.hoisted(() => vi.fn());

vi.mock('~/stores/activity', () => ({
  useSWRxAuditlogSuggestions: mockUseSWRxAuditlogSuggestions,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('SearchUsernameTypeahead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders active and inactive users in correct groups', async () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: {
        username: { activeUsernames: ['alice'], inactiveUsernames: ['bob'] },
      },
      error: undefined,
      isLoading: false,
    });

    render(<SearchUsernameTypeahead onChange={() => {}} />);

    await userEvent.type(screen.getByRole('combobox'), 'a');

    const menu = await screen.findByRole('listbox');
    expect(within(menu).getByText('Active User')).toBeInTheDocument();
    expect(within(menu).getByText('alice')).toBeInTheDocument();
    expect(within(menu).getByText('Inactive User')).toBeInTheDocument();
    expect(within(menu).getByText('bob')).toBeInTheDocument();
  });

  it('filters out already-selected usernames from the suggestion menu', async () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: {
        username: { activeUsernames: ['alice', 'bob'], inactiveUsernames: [] },
      },
      error: undefined,
      isLoading: false,
    });

    render(
      <SearchUsernameTypeahead
        onChange={() => {}}
        initialUsernames={['alice']}
      />,
    );

    await userEvent.type(screen.getByRole('combobox'), 'b');

    const menu = await screen.findByRole('listbox');
    expect(within(menu).getByText('bob')).toBeInTheDocument();
    expect(within(menu).queryByText('alice')).not.toBeInTheDocument();
  });

  it('renders no options when response has no username data', async () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: {},
      error: undefined,
      isLoading: false,
    });

    render(<SearchUsernameTypeahead onChange={() => {}} />);

    await userEvent.type(screen.getByRole('combobox'), 'a');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
