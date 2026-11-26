import type { JSX } from 'react';
import { format } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import {
  BACKFILL_RETRY_DELAYS_MS,
  type BacklinksBackfillState,
} from '../../interfaces/page-link-backfill';
import type { BackfillAdminViewKind } from '../utils/backfill-admin-view';

type Props = {
  readonly kind: BackfillAdminViewKind;
  readonly state: BacklinksBackfillState;
};

const formatDate = (iso: string | null): string =>
  iso == null ? '-' : format(new Date(iso), 'yyyy-MM-dd HH:mm');

// The error is rendered as its own text, not interpolated, so i18next does not HTML-escape it.
const LastError = ({ error }: { error: string | null }): JSX.Element => {
  const { t } = useTranslation('admin');
  return (
    <p className="text-danger mb-1">
      {t('admin:backlinks_backfill.failed')}{' '}
      <code>{error ?? t('admin:backlinks_backfill.unknown_error')}</code>
    </p>
  );
};

/** The one line (or two, for a failure) that says where the backfill stands. */
export const BackfillStatusMessage = ({ kind, state }: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  const message = (() => {
    switch (kind) {
      case 'notStarted':
        return (
          <p>
            {t('admin:backlinks_backfill.not_started', {
              pages: state.totalPageCount,
            })}
          </p>
        );
      case 'running':
        return (
          <p>
            {state.runTotal == null
              ? t('admin:backlinks_backfill.waiting')
              : t('admin:backlinks_backfill.running')}
          </p>
        );
      case 'stopping':
        return <p>{t('admin:backlinks_backfill.stopping')}</p>;
      case 'failedRetryDue':
        return (
          <>
            <LastError error={state.lastError} />
            <p>
              {t('admin:backlinks_backfill.retry_at', {
                retryAt: formatDate(state.retryAt),
                attempt: state.failedAttempts,
                max: BACKFILL_RETRY_DELAYS_MS.length,
              })}
            </p>
          </>
        );
      case 'failed':
        return (
          <>
            <LastError error={state.lastError} />
            <p>{t('admin:backlinks_backfill.failed_no_retry')}</p>
          </>
        );
      case 'stopped': {
        const total = state.runTotal ?? 0;
        return (
          <p>
            {t('admin:backlinks_backfill.stopped', {
              processed: Math.min(state.processed, total),
              total,
            })}
          </p>
        );
      }
      case 'partial':
        return (
          <>
            <p className="mb-2">{t('admin:backlinks_backfill.partial')}</p>
            <dl className="mb-0">
              <div className="d-flex gap-2">
                <dt className="fw-normal">
                  {t('admin:backlinks_backfill.covered_since')}
                </dt>
                <dd className="fw-bold mb-1">
                  {formatDate(state.coveredSince)}
                </dd>
              </div>
              <div className="d-flex gap-2">
                <dt className="fw-normal">
                  {t('admin:backlinks_backfill.not_included')}
                </dt>
                <dd className="fw-bold mb-1">
                  {t('admin:backlinks_backfill.not_included_pages', {
                    pages: state.notIncludedCount,
                  })}
                </dd>
              </div>
            </dl>
          </>
        );
      case 'all':
        return (
          <p className="text-success">
            {t('admin:backlinks_backfill.all', {
              completedAt: formatDate(state.completedAt),
            })}
          </p>
        );
    }
  })();

  return <div data-testid="backfill-status">{message}</div>;
};
