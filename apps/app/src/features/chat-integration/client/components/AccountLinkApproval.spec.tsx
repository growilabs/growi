// Proves task 6.1's screen-level contract (design.md: "どのチャットアカウ
// ントを、どの GROWI ユーザーに結び付けるのかを画面に出す") -- the screen
// shows the chat account, GROWI user, and workspace before approval, and
// calling approve reflects the outcome the API answered with.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routerQuery: { token: 'test-token' } as Record<string, unknown>,
  apiv3Get: vi.fn(),
  apiv3Post: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ query: mocks.routerQuery }),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/states/global', () => ({
  useAppTitle: () => 'Acme Wiki',
  useSiteUrl: () => 'https://wiki.example.test',
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mocks.apiv3Get,
  apiv3Post: mocks.apiv3Post,
}));

import { AccountLinkApproval } from './AccountLinkApproval';

const DISPLAY = {
  platform: 'slack',
  accountId: 'U-alice',
  workspaceName: 'Test Workspace',
  relationLabel: 'Our Slack',
  growiUsername: 'approving-user',
  growiName: 'Approving Person',
  accountDisplayName: 'Alice A.',
  expiresAt: '2030-01-01T00:00:00.000Z',
};

// A fresh SWR cache per render -- otherwise a later test's fetch for the
// same token/key resolves instantly from the previous test's cached data
// instead of calling `apiv3Get` again (SWR's default cache is a module-level
// singleton shared across every render in the process).
const renderApproval = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AccountLinkApproval />
    </SWRConfig>,
  );

describe('AccountLinkApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presents the GROWI, the logged-in user and the chat account as three distinct groups', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: DISPLAY });

    renderApproval();

    const growi = await screen.findByRole('group', {
      name: 'chat_integration.account_link.growi_heading',
    });
    expect(within(growi).getByText('Acme Wiki')).toBeInTheDocument();
    expect(within(growi).getByText('wiki.example.test')).toBeInTheDocument();

    const you = screen.getByRole('group', {
      name: 'chat_integration.account_link.you_heading',
    });
    expect(within(you).getByText('Approving Person')).toBeInTheDocument();
    expect(within(you).getByText('@approving-user')).toBeInTheDocument();

    const chat = screen.getByRole('group', {
      name: 'chat_integration.account_link.chat_account_heading',
    });
    expect(within(chat).getByText('slack')).toBeInTheDocument();
    expect(within(chat).getByText(/Test Workspace/)).toBeInTheDocument();
    expect(within(chat).getByText(/Our Slack/)).toBeInTheDocument();
  });

  it('shows both the display name and the account identifier when the chat service gave a name', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: DISPLAY });

    renderApproval();

    const chat = await screen.findByRole('group', {
      name: 'chat_integration.account_link.chat_account_heading',
    });
    expect(within(chat).getByText('Alice A.')).toBeInTheDocument();
    expect(within(chat).getByText('U-alice')).toBeInTheDocument();
  });

  it('shows only the account identifier when the order has no display name', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { ...DISPLAY, accountDisplayName: null },
    });

    renderApproval();

    const chat = await screen.findByRole('group', {
      name: 'chat_integration.account_link.chat_account_heading',
    });
    expect(within(chat).getByText('U-alice')).toBeInTheDocument();
    expect(within(chat).queryByText('Alice A.')).not.toBeInTheDocument();
  });

  it('shows the expiry and tells the user to close the page if they do not recognize the request', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: DISPLAY });

    renderApproval();

    expect(
      await screen.findByText('chat_integration.account_link.ignore_hint'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('chat_integration.account_link.expires_at'),
    ).toBeInTheDocument();
  });

  it('shows a linked confirmation after a successful approval', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: DISPLAY });
    mocks.apiv3Post.mockResolvedValue({ data: { status: 'linked' } });
    const user = userEvent.setup();

    renderApproval();
    await screen.findByRole('button', {
      name: 'chat_integration.account_link.approve',
    });
    await user.click(screen.getByRole('button', {
      name: 'chat_integration.account_link.approve',
    }));

    await waitFor(() => {
      expect(screen.getByText('chat_integration.account_link.linked')).toBeInTheDocument();
    });
  });

  it("shows the 'taken by another user' outcome when the API refuses with that code", async () => {
    mocks.apiv3Get.mockResolvedValue({ data: DISPLAY });
    mocks.apiv3Post.mockRejectedValue([{ code: 'taken-by-another-user' }]);
    const user = userEvent.setup();

    renderApproval();
    await screen.findByRole('button', {
      name: 'chat_integration.account_link.approve',
    });
    await user.click(screen.getByRole('button', {
      name: 'chat_integration.account_link.approve',
    }));

    await waitFor(() => {
      expect(
        screen.getByText('chat_integration.account_link.taken_by_another_user'),
      ).toBeInTheDocument();
    });
  });

  it('shows an invalid/expired message when the order cannot be found', async () => {
    mocks.apiv3Get.mockRejectedValue(new Error('404'));

    renderApproval();

    expect(
      await screen.findByText(
        'chat_integration.account_link.invalid_or_expired',
      ),
    ).toBeInTheDocument();
  });
});
