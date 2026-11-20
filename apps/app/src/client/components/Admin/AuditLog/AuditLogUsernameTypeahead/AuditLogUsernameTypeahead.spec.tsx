import type { JSX, ReactNode } from 'react';
import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';

import type { IClearable } from '~/client/interfaces/clearable';

import { AuditLogUsernameTypeahead } from './AuditLogUsernameTypeahead';

const mockApiv3Get = vi.hoisted(() => vi.fn());

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mockApiv3Get,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const AUDITLOG_SUGGESTIONS_ENDPOINT = '/activity/suggestions';
const REGISTERED_USERNAMES_ENDPOINT = '/users/usernames';

// Fresh SWR cache per render: the suggestion hook is `useSWRImmutable`, so a
// key cached by an earlier test is served without calling the fetcher again.
const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const requestedEndpoints = () =>
  mockApiv3Get.mock.calls.map(([endpoint]) => endpoint);

const respondWithUsernames = (activeUsernames: string[]) => {
  mockApiv3Get.mockResolvedValue({
    data: { username: { activeUsernames, inactiveUsernames: [] } },
  });
};

describe('AuditLogUsernameTypeahead', () => {
  beforeEach(() => {
    mockApiv3Get.mockResolvedValue({ data: {} });
  });

  /**
   * The audit-log filter has to suggest operators who no longer exist as users,
   * which only `/activity/suggestions` returns. Asserted on the endpoint
   * actually requested, so it survives refactoring of how the source reaches
   * the typeahead.
   */
  it('suggests usernames from the admin-only endpoint, never the registered-users one', async () => {
    render(<AuditLogUsernameTypeahead onChange={vi.fn()} />, { wrapper });

    await userEvent.type(screen.getByRole('combobox'), 'ali');

    // Without waiting for a request to land, the negative assertion below passes
    // vacuously — before the debounced `onSearch` has fired at all.
    await waitFor(() => {
      expect(requestedEndpoints()).toContain(AUDITLOG_SUGGESTIONS_ENDPOINT);
    });

    expect(requestedEndpoints()).not.toContain(REGISTERED_USERNAMES_ENDPOINT);
  });

  /**
   * `AuditLogManagement`'s clear button drives the input through this ref
   * (`clearButtonPushedHandler` → `typeaheadRef.current?.clear()`), and this
   * component sits between it and the typeahead that owns the selection.
   *
   * Written as a wrapper-level test on purpose: React drops a ref handed to a
   * plain function component silently — no warning, no type error — so the only
   * symptom is the clear button quietly doing nothing.
   */
  it('empties the input when clear() is called on the forwarded ref', async () => {
    respondWithUsernames(['alice']);
    const ref = createRef<IClearable>();

    render(<AuditLogUsernameTypeahead ref={ref} onChange={vi.fn()} />, {
      wrapper,
    });

    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'alice');
    await userEvent.click(await screen.findByRole('option', { name: 'alice' }));
    expect(screen.getByText('alice')).toBeInTheDocument();

    act(() => {
      ref.current?.clear();
    });

    expect(screen.queryByText('alice')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  /**
   * `AuditLogExportModal` prefills the filter through `initialUsernames`.
   *
   * Tested at this level because this component is the one that takes props
   * apart (`const { placeholder, ...rest }`) before forwarding them, and
   * neither admin call site has a spec of its own — so a prop that stopped
   * being forwarded would fail nowhere.
   */
  it('forwards initialUsernames to the typeahead', () => {
    render(
      <AuditLogUsernameTypeahead
        onChange={vi.fn()}
        initialUsernames={['alice']}
      />,
      { wrapper },
    );

    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  // The `t` mock echoes the key, so this pins the namespace — the load-bearing
  // part. Owning the default here is what lets the admin call sites render this
  // without a `placeholder` prop at all.
  it('defaults the placeholder to the admin-namespaced key', () => {
    render(<AuditLogUsernameTypeahead onChange={vi.fn()} />, { wrapper });

    expect(screen.getByRole('combobox')).toHaveAttribute(
      'placeholder',
      'admin:audit_log_management.username',
    );
  });
});
