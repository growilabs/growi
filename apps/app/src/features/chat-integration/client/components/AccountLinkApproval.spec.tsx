// Proves task 6.1's screen-level contract (design.md: "どのチャットアカウ
// ントを、どの GROWI ユーザーに結び付けるのかを画面に出す") -- the screen
// shows the chat account, GROWI user, and workspace before approval, and
// calling approve reflects the outcome the API answered with.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routerQuery: {
    path: ['chat-integration', 'account-link', 'test-token'],
  } as Record<string, unknown>,
  apiv3Get: vi.fn(),
  apiv3Post: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ query: mocks.routerQuery }),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

  it('shows which chat account, GROWI user, and workspace are about to be linked', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: DISPLAY });

    renderApproval();

    expect(await screen.findByText(/Test Workspace/)).toBeInTheDocument();
    expect(screen.getByText(/U-alice/)).toBeInTheDocument();
    expect(screen.getByText(/approving-user/)).toBeInTheDocument();
  });

  it('shows a linked confirmation after a successful approval', async () => {
    mocks.apiv3Get.mockResolvedValue({ data: DISPLAY });
    mocks.apiv3Post.mockResolvedValue({ data: { status: 'linked' } });
    const user = userEvent.setup();

    renderApproval();
    await screen.findByRole('button', { name: /approve/i });
    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(screen.getByText(/has been linked/i)).toBeInTheDocument();
    });
  });

  it("shows the 'taken by another user' outcome when the API refuses with that code", async () => {
    mocks.apiv3Get.mockResolvedValue({ data: DISPLAY });
    mocks.apiv3Post.mockRejectedValue([{ code: 'taken-by-another-user' }]);
    const user = userEvent.setup();

    renderApproval();
    await screen.findByRole('button', { name: /approve/i });
    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/already linked to a different GROWI user/i),
      ).toBeInTheDocument();
    });
  });

  it('shows an invalid/expired message when the order cannot be found', async () => {
    mocks.apiv3Get.mockRejectedValue(new Error('404'));

    renderApproval();

    expect(
      await screen.findByText(/invalid, already used, or has expired/i),
    ).toBeInTheDocument();
  });
});
