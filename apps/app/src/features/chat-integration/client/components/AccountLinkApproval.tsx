// The approval screen for a one-time chat-account-link token (design.md
// "ChatAccountLink" -- "承認画面" row: "ログイン必須。どのチャットアカウン
// トを、どの GROWI ユーザーに結び付けるのかを画面に出す"). Rendered from
// `pages/me/[[...path]].page.tsx`'s `chat-integration` entry -- the page
// component reads the token itself (via `useRouter()`) rather than the
// dispatcher passing it down, since the dispatcher only routes on the
// FIRST path segment (`me/[[...path]].page.tsx`'s own fix, task 6.1).
//
// Login itself is already enforced twice before this component ever
// mounts: the Express route this page lives under (`/me/*`,
// `server/routes/index.js`) requires login before Next.js renders
// anything, and the API this component calls
// (`account-link-router.ts`) requires it independently. This component
// adds nothing to that enforcement -- it only renders what a logged-in
// user is shown.

import { type JSX, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import useSWR from 'swr';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';

interface AccountLinkOrderDisplay {
  readonly platform: string;
  readonly accountId: string;
  readonly workspaceName: string;
  readonly relationLabel: string | null;
  readonly growiUsername: string;
}

/**
 * `/me/chat-integration/account-link/:token` -- the 3rd path segment is the
 * token (`create-link-order.ts`'s `ACCOUNT_LINK_ACCEPT_PATH`, followed by
 * `/:token`). Segments before it (`chat-integration`, `account-link`) are
 * fixed by that same constant, so only the token varies.
 */
const useAccountLinkToken = (): string | undefined => {
  const router = useRouter();
  const { path } = router.query;
  const segments = Array.isArray(path) ? path : [];
  return segments[2];
};

const fetchOrder = async (
  token: string,
): Promise<AccountLinkOrderDisplay | null> => {
  try {
    const res = await apiv3Get<AccountLinkOrderDisplay>(
      `/chat-integration/account-link/${token}`,
    );
    return res.data;
  } catch {
    return null;
  }
};

type ApprovalOutcome =
  | 'linked'
  | 'invalid-or-expired'
  | 'taken-by-another-user';

const approveOrder = async (token: string): Promise<ApprovalOutcome> => {
  try {
    await apiv3Post(`/chat-integration/account-link/${token}/approve`);
    return 'linked';
  } catch (errors) {
    const code = Array.isArray(errors) ? errors[0]?.code : undefined;
    return code === 'taken-by-another-user'
      ? 'taken-by-another-user'
      : 'invalid-or-expired';
  }
};

export const AccountLinkApproval = (): JSX.Element => {
  const { t } = useTranslation();
  const token = useAccountLinkToken();
  const [outcome, setOutcome] = useState<ApprovalOutcome | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: display, error } = useSWR(
    token != null ? ['chat-integration-account-link', token] : null,
    () => fetchOrder(token as string),
  );

  if (token == null) {
    return <h2>{t('commons:not_found_page.page_not_exist')}</h2>;
  }

  if (outcome === 'linked') {
    return <p>Your chat account has been linked to your GROWI account.</p>;
  }
  if (outcome === 'taken-by-another-user') {
    return (
      <p>This chat account is already linked to a different GROWI user.</p>
    );
  }
  if (outcome === 'invalid-or-expired' || error || display === null) {
    return <p>This link is invalid, already used, or has expired.</p>;
  }

  if (display == null) {
    return <p>Loading…</p>;
  }

  const handleApprove = async (): Promise<void> => {
    setIsSubmitting(true);
    const result = await approveOrder(token);
    setIsSubmitting(false);
    setOutcome(result);
  };

  return (
    <div>
      <p>
        Link the following chat account to your GROWI account (
        <strong>{display.growiUsername}</strong>)?
      </p>
      <ul>
        <li>Platform: {display.platform}</li>
        <li>Chat account: {display.accountId}</li>
        <li>Workspace: {display.workspaceName}</li>
        {display.relationLabel != null && (
          <li>Connection label: {display.relationLabel}</li>
        )}
      </ul>
      <button type="button" onClick={handleApprove} disabled={isSubmitting}>
        Approve
      </button>
    </div>
  );
};
