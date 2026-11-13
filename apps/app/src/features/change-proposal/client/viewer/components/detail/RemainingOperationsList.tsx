import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalView } from '../../../../interfaces';
import {
  OPERATION_REASON_LABEL_KEYS,
  OPERATION_STATUS_LABEL_KEYS,
  selectRemainingOperations,
} from '../../../shared';
import { StatusBadge } from '../StatusBadge';
import { SymbolIcon } from '../SymbolIcon';
import { OPERATION_STATUS_APPEARANCE } from '../status-appearance';

import styles from './DetailPanel.module.scss';

type RemainingOperationsListProps = {
  readonly view: Pick<ChangeProposalView, 'isRequester' | 'operations'>;
};

export const RemainingOperationsList = ({
  view,
}: RemainingOperationsListProps): JSX.Element | null => {
  const { t } = useTranslation();
  if (!view.isRequester) {
    return null;
  }
  const remaining = selectRemainingOperations(view.operations);
  if (remaining.length === 0) {
    return null;
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>
        <SymbolIcon name="pending_actions" className={styles['title-icon']} />
        {t('change_proposal_viewer.remaining_operations.title')}
      </h2>
      <ul className={styles.rows}>
        {remaining.map((operation) => {
          const path =
            operation.page?.path ??
            operation.path ??
            operation.toPath ??
            operation.fromPath;
          return (
            <li key={operation.key} className={styles.row}>
              {path != null ? (
                <code className={styles.path}>{path}</code>
              ) : (
                <span className={styles['page-gone']}>
                  {t('change_proposal_viewer.operation.page_gone')}
                </span>
              )}
              <span className={styles.result}>
                <StatusBadge
                  appearance={OPERATION_STATUS_APPEARANCE[operation.status]}
                  label={t(OPERATION_STATUS_LABEL_KEYS[operation.status])}
                />
                {operation.reason != null && (
                  <span className={styles.reason}>
                    {t(OPERATION_REASON_LABEL_KEYS[operation.reason])}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
