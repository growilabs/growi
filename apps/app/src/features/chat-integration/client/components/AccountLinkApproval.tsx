// The approval screen for a one-time chat-account-link token (design.md
// "ChatAccountLink" -- "承認画面" row). Rendered by the dedicated page
// `pages/me/chat-integration/account-link/[token].page.tsx`, which supplies
// the token through `router.query.token`.
//
// It shows, before approval, three distinct groups: this GROWI, the GROWI
// user who is logged in, and the chat account to be linked. The display
// name never appears without the identifier (Requirement 7.11; the reason is
// in chat-integration-app/research.md).
//
// Login itself is already enforced twice before this component ever
// mounts: the Express route this page lives under (`/me/*`,
// `server/routes/index.js`) requires login before Next.js renders
// anything, and the API this component calls
// (`account-link-router.ts`) requires it independently.

import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { isErrorV3 } from '@growi/core/dist/models';
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

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

const useAccountLinkToken = (): string | undefined => {
  const router = useRouter();
  const { token } = router.query;
  // The token goes into an API path; accept only what the server issues
  // (32 random bytes, hex) so a crafted link cannot steer the request.
  return typeof token === 'string' && TOKEN_PATTERN.test(token)
    ? token
    : undefined;
};

/** Host name plus any non-default port: two GROWIs on one host differ only by it. */
const hostOf = (siteUrl: string | undefined): string | null => {
  if (!siteUrl) {
    return null;
  }
  try {
    return new URL(siteUrl).host;
  } catch {
    return null;
  }
};

/** The code of the first `ErrorV3` an `apiv3` call threw, if any. */
const firstErrorCode = (errors: unknown): string | undefined => {
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  return isErrorV3(first) ? first.code : undefined;
};

/**
 * `null` only when the server says the token is not live. Any other failure
 * (network, 5xx, lost session) is thrown, so the screen does not call a
 * possibly valid link dead.
 */
const fetchOrder = async (
  token: string,
): Promise<AccountLinkOrderDisplay | null> => {
  try {
    const res = await apiv3Get<AccountLinkOrderDisplay>(
      `/chat-integration/account-link/${token}`,
    );
    return res.data;
  } catch (errors) {
    if (firstErrorCode(errors) === 'invalid-or-expired') {
      return null;
    }
    throw errors;
  }
};

type ApprovalOutcome =
  | 'linked'
  | 'invalid-or-expired'
  | 'taken-by-another-user'
  /** Neither answer above: the approval may be retried. */
  | 'failed';

const approveOrder = async (token: string): Promise<ApprovalOutcome> => {
  try {
    await apiv3Post(`/chat-integration/account-link/${token}/approve`);
    return 'linked';
  } catch (errors) {
    const code = firstErrorCode(errors);
    if (code === 'taken-by-another-user' || code === 'invalid-or-expired') {
      return code;
    }
    return 'failed';
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
  const { t, i18n } = useTranslation();
  const token = useAccountLinkToken();
  const appTitle = useAppTitle();
  const siteUrl = useSiteUrl();
  const [outcome, setOutcome] = useState<ApprovalOutcome | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // What was approved, kept for the success screen: the cached order itself
  // is marked revoked as soon as the approval succeeds.
  const [linked, setLinked] = useState<AccountLinkOrderDisplay | null>(null);

  const {
    data: fetched,
    error,
    mutate,
  } = useSWR(
    token != null ? ['chat-integration-account-link', token] : null,
    () => fetchOrder(token as string),
  );
  const display = linked ?? fetched;

  useEffect(() => {
    if (linked != null) {
      // A later mount must not offer the revoked order from the cache.
      void mutate(null, { revalidate: false });
    }
  }, [linked, mutate]);

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
  if (outcome === 'invalid-or-expired' || display === null) {
    return (
      <Card>
        <p className="mb-0">
          {t('chat_integration.account_link.invalid_or_expired')}
        </p>
      </Card>
    );
  }

  if (display == null && error != null) {
    return (
      <Card>
        <p className="mb-0">{t('chat_integration.account_link.load_failed')}</p>
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
    if (result === 'linked') {
      setLinked(display);
    }
    setIsSubmitting(false);
    setOutcome(result);
  };

  const host = hostOf(siteUrl);

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
              <bdi className="me-2">{display.growiName}</bdi>
            )}
            <bdi>@{display.growiUsername}</bdi>
          </Row>
        </Group>
      )}

      <Group heading={t('chat_integration.account_link.chat_account_heading')}>
        <Row term={t('chat_integration.account_link.service_label')}>
          <span className="text-capitalize">{display.platform}</span>
          {' · '}
          <bdi>{display.workspaceName}</bdi>
          {display.relationLabel != null && (
            <bdi> ({display.relationLabel})</bdi>
          )}
        </Row>
        <Row term={t('chat_integration.account_link.account_label')}>
          {display.accountDisplayName != null && (
            <bdi className="me-2">{display.accountDisplayName}</bdi>
          )}
          <span>
            <span className="text-muted me-1">
              {t('chat_integration.account_link.id_label')}:
            </span>
            <bdi>{display.accountId}</bdi>
          </span>
        </Row>
      </Group>

      {outcome === 'linked' ? (
        <p className="mb-0">{t('chat_integration.account_link.linked')}</p>
      ) : (
        <>
          <p className="small mb-1">
            {t('chat_integration.account_link.expires_at', {
              // GROWI's language codes use `_` (`ja_JP`); Intl wants `-`.
              expiresAt: new Date(display.expiresAt).toLocaleString(
                i18n?.language?.replace('_', '-'),
              ),
            })}
          </p>
          <p className="small text-muted">
            {t('chat_integration.account_link.ignore_hint')}
          </p>
          {outcome === 'failed' && (
            <p className="small text-danger" role="alert">
              {t('chat_integration.account_link.approve_failed')}
            </p>
          )}
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
