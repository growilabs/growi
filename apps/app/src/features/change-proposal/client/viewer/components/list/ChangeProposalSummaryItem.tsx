import type { JSX } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import UserDate from '~/components/User/UserDate';

import type { ChangeProposalSummaryView } from '../../../../interfaces';
import { buildProposalHref, PROPOSAL_STATUS_LABEL_KEYS } from '../../../shared';
import { ENTRY_LABEL_KEYS } from '../../domain';

const INITIAL_VISIBLE_PATH_COUNT = 3;

type ChangeProposalSummaryItemProps = {
  readonly proposal: ChangeProposalSummaryView;
  readonly dateTime: string;
};

export const ChangeProposalSummaryItem = ({
  proposal,
  dateTime,
}: ChangeProposalSummaryItemProps): JSX.Element => {
  const { t } = useTranslation();
  const [showsAllPages, setShowsAllPages] = useState(false);
  const { requester, entry, modelLabel, status, pages } = proposal;

  const visiblePages = showsAllPages
    ? pages
    : pages.slice(0, INITIAL_VISIBLE_PATH_COUNT);
  const hasHiddenPages = pages.length > visiblePages.length;

  return (
    <li className="list-group-item">
      <Link
        href={buildProposalHref(proposal.id)}
        className="d-block text-decoration-none text-reset"
      >
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="fw-bold">{`${requester.name} (@${requester.username})`}</span>
          <span className="badge text-bg-light border">
            {t(ENTRY_LABEL_KEYS[entry])}
          </span>
          {modelLabel != null && (
            <span className="text-muted">{modelLabel}</span>
          )}
          <span className="text-muted">
            <UserDate dateTime={dateTime} />
          </span>
          <span className="badge text-bg-secondary">
            {t(PROPOSAL_STATUS_LABEL_KEYS[status])}
          </span>
        </div>
      </Link>
      {visiblePages.length > 0 && (
        <ul className="list-unstyled mb-0 mt-1 small">
          {visiblePages.map((page) => (
            <li key={page.id} className="text-break">
              {page.path ?? (
                <span className="text-muted">
                  {t('change_proposal_viewer.operation.page_gone')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasHiddenPages && (
        <button
          type="button"
          className="btn btn-link btn-sm p-0"
          onClick={() => setShowsAllPages(true)}
        >
          {t('change_proposal_viewer.list.show_more_pages')}
        </button>
      )}
    </li>
  );
};
