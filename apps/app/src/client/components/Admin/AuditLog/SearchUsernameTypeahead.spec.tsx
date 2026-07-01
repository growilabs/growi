import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

import { SearchUsernameTypeahead } from './SearchUsernameTypeahead';

const mockUseSWRxAuditlogSuggestions = vi.hoisted(() => vi.fn());

vi.mock('~/stores/activity', () => ({
  useSWRxAuditlogSuggestions: mockUseSWRxAuditlogSuggestions,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-bootstrap-typeahead', () => {
  const Menu = Object.assign(
    ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
    {
      Header: ({ children }: { children: ReactNode }) => (
        <li className="menu-header">{children}</li>
      ),
      Divider: () => <li className="menu-divider" />,
    },
  );

  return {
    AsyncTypeahead: (props: {
      options: object[];
      filterBy?: (option: object) => boolean;
      renderMenu?: (opts: object[], p: object) => ReactNode;
      [key: string]: unknown;
    }) => {
      const options = props.filterBy
        ? props.options.filter(props.filterBy)
        : props.options;
      return <>{props.renderMenu?.(options, { id: 'test-menu' })}</>;
    },
    Menu,
    MenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  };
});

describe('SearchUsernameTypeahead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders active and inactive users in correct groups', () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: {
        username: { activeUsernames: ['alice'], inactiveUsernames: ['bob'] },
      },
      error: undefined,
      isLoading: false,
    });

    render(<SearchUsernameTypeahead onChange={() => {}} />);

    expect(screen.getByText('Active User')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Inactive User')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('filters out already-selected usernames from the suggestion menu', () => {
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

    expect(screen.queryByText('alice')).not.toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('renders no options when response has no username data', () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: {},
      error: undefined,
      isLoading: false,
    });

    render(<SearchUsernameTypeahead onChange={() => {}} />);

    expect(screen.queryByText('Active User')).not.toBeInTheDocument();
    expect(screen.queryByText('Inactive User')).not.toBeInTheDocument();
  });
});
