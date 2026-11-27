import type { JSX } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import { formatProposalShortId } from '../../../shared';
import { CHANGE_PROPOSAL_LIST_HREF } from '../../consts';
import { SymbolIcon } from '../SymbolIcon';

import styles from './ChangeProposalDetailHeading.module.scss';

type ChangeProposalDetailHeadingProps = {
  // null when the URL does not hold a valid id; the heading then has no id.
  readonly proposalId: string | null;
};

export const ChangeProposalDetailHeading = ({
  proposalId,
}: ChangeProposalDetailHeadingProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <div className={styles.heading}>
      <Link href={CHANGE_PROPOSAL_LIST_HREF} className={styles['back-link']}>
        <SymbolIcon name="arrow_back" className={styles['back-icon']} />
        {t('change_proposal_viewer.list.title')}
      </Link>
      <h1 className={`fs-3 ${styles.title}`}>
        {t('change_proposal_viewer.mark.change_proposal')}
        {proposalId != null && (
          <span className={styles['short-id']}>
            {formatProposalShortId(proposalId)}
          </span>
        )}
      </h1>
    </div>
  );
};
