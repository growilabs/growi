// The approval screen for a one-time chat-account-link token (design.md
// "ChatAccountLink" -- "承認画面" row). Rendered by the dedicated page
// `pages/me/chat-integration/account-link/[token].page.tsx`, which supplies
// the token through `router.query.token`.
//
// It shows, before approval, three distinct groups: this GROWI, the GROWI
// user who is logged in, and the chat account to be linked. The chat
// account's display name is only ever shown next to its identifier -- a
// display name is chosen by the account owner and is not an identity.
//
// Login itself is already enforced twice before this component ever
// mounts: the Express route this page lives under (`/me/*`,
// `server/routes/index.js`) requires login before Next.js renders
// anything, and the API this component calls
// (`account-link-router.ts`) requires it independently.

import { type JSX, type ReactNode, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import useSWR from 'swr';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { useAppTitle, useSiteUrl } from '~/states/global';

interface AccountLinkOrderDisplay {
  readonly platform: string;
  readonly accountId: string;
  readonly workspaceName: string;
  readonly relationLabel: string | null;
  readonly growiUsername: string;
  readonly growiName: string | null;
  readonly accountDisplayName: string | null;
  readonly expiresAt: string;
}

const useAccountLinkToken = (): string | undefined => {
  const router = useRouter();
  const { token } = router.query;
  return typeof token === 'string' ? token : undefined;
};

const hostnameOf = (siteUrl: string | undefined): string | null => {
  if (!siteUrl) {
    return null;
  }
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return null;
  }
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

const Card = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="container py-5" style={{ maxWidth: 480 }}>
    <div className="card shadow-sm">
      <div className="card-body">{children}</div>
    </div>
  </div>
);

const Group = ({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}): JSX.Element => (
  <fieldset className="mb-3">
    <legend className="fs-6 fw-bold text-muted mb-1">{heading}</legend>
    <dl className="mb-0">{children}</dl>
  </fieldset>
);

const Row = ({
  term,
  children,
}: {
  term: string;
  children: ReactNode;
}): JSX.Element => (
  <div className="d-flex gap-2">
    <dt className="fw-normal text-muted">{term}</dt>
    <dd className="mb-0">{children}</dd>
  </div>
);

export const AccountLinkApproval = (): JSX.Element => {
  const { t } = useTranslation();
  const token = useAccountLinkToken();
  const appTitle = useAppTitle();
  const siteUrl = useSiteUrl();
  const [outcome, setOutcome] = useState<ApprovalOutcome | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: display, error } = useSWR(
    token != null ? ['chat-integration-account-link', token] : null,
    () => fetchOrder(token as string),
  );

  if (token == null) {
    return (
      <Card>
        <p className="mb-0">{t('commons:not_found_page.page_not_exist')}</p>
      </Card>
    );
  }

  if (outcome === 'taken-by-another-user') {
    return (
      <Card>
        <p className="mb-0">
          {t('chat_integration.account_link.taken_by_another_user')}
        </p>
      </Card>
    );
  }
  if (outcome === 'invalid-or-expired' || error || display === null) {
    return (
      <Card>
        <p className="mb-0">
          {t('chat_integration.account_link.invalid_or_expired')}
        </p>
      </Card>
    );
  }

  if (display == null) {
    return (
      <Card>
        <p className="mb-0">{t('chat_integration.account_link.loading')}</p>
      </Card>
    );
  }

  const handleApprove = async (): Promise<void> => {
    setIsSubmitting(true);
    const result = await approveOrder(token);
    setIsSubmitting(false);
    setOutcome(result);
  };

  const host = hostnameOf(siteUrl);

  return (
    <Card>
      <h1 className="fs-5 mb-3">
        {t('chat_integration.account_link.heading')}
      </h1>

      {outcome !== 'linked' && (
        <Group heading={t('chat_integration.account_link.growi_heading')}>
          <Row term={t('chat_integration.account_link.name_label')}>
            {appTitle}
          </Row>
          {host != null && <Row term="URL">{host}</Row>}
        </Group>
      )}

      {outcome !== 'linked' && (
        <Group heading={t('chat_integration.account_link.you_heading')}>
          <Row term={t('chat_integration.account_link.user_label')}>
            {display.growiName != null && (
              <span className="me-2">{display.growiName}</span>
            )}
            <span>@{display.growiUsername}</span>
          </Row>
        </Group>
      )}

      <Group heading={t('chat_integration.account_link.chat_account_heading')}>
        <Row term={t('chat_integration.account_link.service_label')}>
          <span className="text-capitalize">{display.platform}</span>
          {' · '}
          <span>{display.workspaceName}</span>
          {display.relationLabel != null && (
            <span>（{display.relationLabel}）</span>
          )}
        </Row>
        <Row term={t('chat_integration.account_link.account_label')}>
          {display.accountDisplayName != null && (
            <span className="me-2">{display.accountDisplayName}</span>
          )}
          <span>
            <span className="text-muted me-1">
              {t('chat_integration.account_link.id_label')}:
            </span>
            <span>{display.accountId}</span>
          </span>
        </Row>
      </Group>

      {outcome === 'linked' ? (
        <p className="mb-0">{t('chat_integration.account_link.linked')}</p>
      ) : (
        <>
          <p className="small mb-1">
            {t('chat_integration.account_link.expires_at', {
              expiresAt: new Date(display.expiresAt).toLocaleString(),
            })}
          </p>
          <p className="small text-muted">
            {t('chat_integration.account_link.ignore_hint')}
          </p>
          <div className="text-end">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={isSubmitting}
            >
              {t('chat_integration.account_link.approve')}
            </button>
          </div>
        </>
      )}
    </Card>
  );
};
