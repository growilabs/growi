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
    <section className="border rounded p-2 mb-3">
      <h2 className="h6">
        {t('change_proposal_viewer.revert_all.result_title')}
      </h2>
      <ul className="list-unstyled mb-0">
        {run.targets.map((target) => (
          <li key={target.key} className="d-flex flex-wrap gap-2">
            {target.path != null ? (
              <code className="text-break">{target.path}</code>
            ) : (
              <span className="text-muted">
                {t('change_proposal_viewer.operation.page_gone')}
              </span>
            )}
            <span className="small">
              {labelOf(entries.find((entry) => entry.key === target.key))}
            </span>
          </li>
        ))}
      </ul>
      {isTimedOut && (
        <p className="small text-muted mt-2 mb-0">
          {t('change_proposal_viewer.revert_result.timed_out')}
        </p>
      )}
    </section>
  );
};
