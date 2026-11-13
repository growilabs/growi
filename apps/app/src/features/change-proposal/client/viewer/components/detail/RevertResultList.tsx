import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { OperationView, RevertResult } from '../../../../interfaces';
import {
  OPERATION_REASON_LABEL_KEYS,
  OPERATION_STATUS_LABEL_KEYS,
  REVERT_REFUSAL_REASON_LABEL_KEYS,
} from '../../../shared';
import type { RevertProgressEntry } from '../../domain';
import { useRevertProgress } from '../../stores/use-revert-progress';
import { StatusBadge } from '../StatusBadge';
import { SymbolIcon } from '../SymbolIcon';
import { REVERT_PROGRESS_APPEARANCE } from '../status-appearance';

import styles from './DetailPanel.module.scss';

export type RevertTarget = {
  readonly key: string;
  readonly path?: string;
};

// Kept as one value in state so `result` and `sentKeys` stay the same
// references for as long as this revert is shown (useRevertProgress needs that).
export type RevertRun = {
  readonly result: RevertResult;
  readonly targets: readonly RevertTarget[];
  readonly sentKeys: readonly string[];
};

type RevertResultListProps = {
  readonly proposalId: string;
  readonly run: RevertRun;
  readonly originalOperations: readonly OperationView[];
};

export const RevertResultList = ({
  proposalId,
  run,
  originalOperations,
}: RevertResultListProps): JSX.Element => {
  const { t } = useTranslation();
  const { entries, isTimedOut } = useRevertProgress({
    originalProposalId: proposalId,
    sentKeys: run.sentKeys,
    result: run.result,
    originalOperations,
  });

  // A sent key missing from the entries is still in progress.
  const labelOf = (entry: RevertProgressEntry | undefined): string => {
    switch (entry?.state) {
      case 'reverted':
        return t(OPERATION_STATUS_LABEL_KEYS.reverted);
      case 'revert-refused':
        return entry.reason != null
          ? t(REVERT_REFUSAL_REASON_LABEL_KEYS[entry.reason])
          : t(OPERATION_STATUS_LABEL_KEYS['revert-refused']);
      case 'skipped':
        return t(OPERATION_REASON_LABEL_KEYS[entry.reason]);
      case 'not-targeted':
        return t('change_proposal_viewer.revert_result.not_targeted');
      default:
        return t('change_proposal_viewer.revert_result.in_progress');
    }
  };

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>
        <SymbolIcon name="undo" className={styles['title-icon']} />
        {t('change_proposal_viewer.revert_all.result_title')}
      </h2>
      <ul className={styles.rows}>
        {run.targets.map((target) => {
          const entry = entries.find((e) => e.key === target.key);
          return (
            <li key={target.key} className={styles.row}>
              {target.path != null ? (
                <code className={styles.path}>{target.path}</code>
              ) : (
                <span className={styles['page-gone']}>
                  {t('change_proposal_viewer.operation.page_gone')}
                </span>
              )}
              <StatusBadge
                appearance={
                  REVERT_PROGRESS_APPEARANCE[entry?.state ?? 'in-progress']
                }
                label={labelOf(entry)}
              />
            </li>
          );
        })}
      </ul>
      {isTimedOut && (
        <p className={styles.note}>
          {t('change_proposal_viewer.revert_result.timed_out')}
        </p>
      )}
    </section>
  );
};
