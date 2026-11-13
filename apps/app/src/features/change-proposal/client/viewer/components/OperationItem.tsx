import type { JSX } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalView, OperationView } from '../../../interfaces';
import {
  buildProposalHref,
  formatProposalShortId,
  OPERATION_REASON_LABEL_KEYS,
  OPERATION_STATUS_LABEL_KEYS,
  OPERATION_TYPE_LABEL_KEYS,
  REVERT_REFUSAL_REASON_LABEL_KEYS,
} from '../../shared';
import { toDiffPair } from '../stores/use-swrx-operation-diff';
import { ProposalLinkChips } from './detail/ProposalLinkChips';
import { OperationDiff } from './OperationDiff';
import { RequesterActionSlot } from './RequesterActionSlot';
import { StatusBadge } from './StatusBadge';
import { SymbolIcon } from './SymbolIcon';
import {
  OPERATION_STATUS_APPEARANCE,
  OPERATION_TYPE_ICONS,
} from './status-appearance';

import styles from './OperationItem.module.scss';

type OperationItemProps = {
  readonly proposal: ChangeProposalView;
  readonly operation: OperationView;
};

const PathText = ({ value }: { readonly value: string }): JSX.Element => (
  <code className={styles.path}>{value}</code>
);

export const OperationItem = ({
  proposal,
  operation,
}: OperationItemProps): JSX.Element => {
  const { t } = useTranslation();
  const {
    type,
    status,
    reason,
    revertability,
    revertedByProposalId,
    linkedProposals,
  } = operation;

  const renderPaths = (): JSX.Element => {
    if (
      type === 'move' &&
      (operation.fromPath != null || operation.toPath != null)
    ) {
      return (
        <span className={styles.move}>
          {operation.fromPath != null && (
            <PathText value={operation.fromPath} />
          )}
          <span className={styles['move-arrow']} />
          {operation.toPath != null && <PathText value={operation.toPath} />}
        </span>
      );
    }
    const path = operation.page?.path ?? operation.path;
    if (path == null) {
      return (
        <span className={styles['page-gone']}>
          {t('change_proposal_viewer.operation.page_gone')}
        </span>
      );
    }
    return <PathText value={path} />;
  };

  const renderRevertability = (): JSX.Element | null => {
    if (revertability == null) {
      return null;
    }
    return revertability.revertible ? (
      <span className={`${styles.note} ${styles.revertible}`}>
        <SymbolIcon name="undo" className={styles['note-icon']} />
        {t('change_proposal_viewer.operation.revertible')}
      </span>
    ) : (
      <span className={styles.note}>
        <SymbolIcon name="lock" className={styles['note-icon']} />
        {t(REVERT_REFUSAL_REASON_LABEL_KEYS[revertability.reason])}
      </span>
    );
  };

  return (
    <article
      className={styles.operation}
      data-testid="change-proposal-operation"
    >
      <div className={styles.head}>
        <span className={styles.type}>
          <SymbolIcon
            name={OPERATION_TYPE_ICONS[type]}
            className={styles['type-icon']}
          />
          {t(OPERATION_TYPE_LABEL_KEYS[type])}
        </span>
        <StatusBadge
          appearance={OPERATION_STATUS_APPEARANCE[status]}
          label={t(OPERATION_STATUS_LABEL_KEYS[status])}
        />
      </div>
      <h3 className={styles.title}>{renderPaths()}</h3>
      <div className={styles.notes}>
        {reason != null && (
          <span className={styles.note}>
            <SymbolIcon name="info" className={styles['note-icon']} />
            {t(OPERATION_REASON_LABEL_KEYS[reason])}
          </span>
        )}
        {renderRevertability()}
        {revertedByProposalId != null && (
          <span className={styles.note}>
            <SymbolIcon name="undo" className={styles['note-icon']} />
            {t('change_proposal_viewer.operation.reverted_by')}{' '}
            <Link href={buildProposalHref(revertedByProposalId)}>
              {formatProposalShortId(revertedByProposalId)}
            </Link>
          </span>
        )}
        <ProposalLinkChips
          links={(linkedProposals ?? []).map(({ proposalId, relation }) => ({
            proposalId,
            kind: relation,
          }))}
        />
        <RequesterActionSlot proposal={proposal} operation={operation} />
      </div>
      {toDiffPair(operation).type !== 'no-diff' && (
        <OperationDiff operation={operation} />
      )}
    </article>
  );
};
