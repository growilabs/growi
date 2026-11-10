// Proves task 6.2's screen-level contract: the list renders the current
// user's linked chat accounts, and clicking unlink calls the DELETE
// endpoint for that specific row.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiv3Get: vi.fn(),
  apiv3Delete: vi.fn(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mocks.apiv3Get,
  apiv3Delete: mocks.apiv3Delete,
}));

import { MyChatAccountLinks } from './MyChatAccountLinks';

const LINKS = [
  {
    id: 'link-1',
    platform: 'slack',
    accountId: 'U-alice',
    workspaceName: 'Test Workspace',
    relationLabel: 'Our Slack',
    linkedAt: '2026-01-01T00:00:00.000Z',
  },
];

// A fresh SWR cache per render -- same reasoning as
// AccountLinkApproval.spec.tsx: otherwise a later test's fetch resolves
// instantly from a previous test's cached data instead of calling
// `apiv3Get` again.
const renderList = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MyChatAccountLinks />
    </SWRConfig>,
  );

describe('MyChatAccountLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders each linked chat account with its platform, workspace, and account id', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: { links: LINKS } });

    renderList();

    expect(await screen.findByText('Our Slack')).toBeInTheDocument();
    expect(screen.getByText('U-alice')).toBeInTheDocument();
    expect(screen.getByText('slack')).toBeInTheDocument();
  });

  it('shows an empty state when there are no linked accounts', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: { links: [] } });

    renderList();

    expect(
      await screen.findByText(/no chat accounts are linked/i),
    ).toBeInTheDocument();
  });

  it('calls the delete endpoint for the clicked row and refreshes the list', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: { links: LINKS } });
    mocks.apiv3Delete.mockResolvedValue({ data: { status: 'unlinked' } });
    const user = userEvent.setup();

    renderList();
    const unlinkButton = await screen.findByRole('button', {
      name: /disassociate/i,
    });
    await user.click(unlinkButton);

    await waitFor(() => {
      expect(mocks.apiv3Delete).toHaveBeenCalledWith(
        '/chat-integration/my-account-links/link-1',
      );
    });
  });
});
