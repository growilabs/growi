import type { JSX } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import UserDate from '~/components/User/UserDate';

import type { ChangeProposalSummaryView } from '../../../../interfaces';
import { buildProposalHref, PROPOSAL_STATUS_LABEL_KEYS } from '../../../shared';
import { ENTRY_LABEL_KEYS } from '../../domain';
import { ProposalProgressLabel } from '../detail/ProposalProgressLabel';
import { StatusBadge } from '../StatusBadge';
import { SymbolIcon } from '../SymbolIcon';
import { ENTRY_ICONS, PROPOSAL_STATUS_APPEARANCE } from '../status-appearance';

import styles from './ChangeProposalSummaryItem.module.scss';

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
    <li className={styles.item}>
      {/* stretched-link makes the whole card open the detail page; the
          show-more button is lifted above it so it stays clickable. */}
      <Link
        href={buildProposalHref(proposal.id)}
        className={`stretched-link ${styles['item-link']}`}
      >
        <span className={styles.top}>
          <StatusBadge
            appearance={PROPOSAL_STATUS_APPEARANCE[status]}
            label={t(PROPOSAL_STATUS_LABEL_KEYS[status])}
          />
          <ProposalProgressLabel view={proposal} />
          <span className={styles.date}>
            <UserDate dateTime={dateTime} />
          </span>
        </span>
        <span className={styles.who}>
          <span className={styles.name}>{requester.name}</span>
          <span className={styles.username}>{`@${requester.username}`}</span>
          <span className={styles.entry}>
            <SymbolIcon name={ENTRY_ICONS[entry]} className={styles.icon} />
            {t(ENTRY_LABEL_KEYS[entry])}
          </span>
          {modelLabel != null && (
            <span className={styles.model}>{modelLabel}</span>
          )}
        </span>
      </Link>
      {visiblePages.length > 0 && (
        <ul className={styles.pages}>
          {visiblePages.map((page) =>
            page.path != null ? (
              <li key={page.id} className={styles.page}>
                {page.path}
              </li>
            ) : (
              <li
                key={page.id}
                className={`${styles.page} ${styles['page-gone']}`}
              >
                {t('change_proposal_viewer.operation.page_gone')}
              </li>
            ),
          )}
        </ul>
      )}
      {hasHiddenPages && (
        <button
          type="button"
          className={`btn btn-link btn-sm ${styles['show-more']}`}
          onClick={() => setShowsAllPages(true)}
        >
          {t('change_proposal_viewer.list.show_more_pages')}
        </button>
      )}
    </li>
  );
};
