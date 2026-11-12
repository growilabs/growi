import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalView } from '../../../../interfaces';
import {
  OPERATION_REASON_LABEL_KEYS,
  OPERATION_STATUS_LABEL_KEYS,
  selectRemainingOperations,
} from '../../../shared';

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
    <section className="mb-3">
      <h2 className="h5">
        {t('change_proposal_viewer.remaining_operations.title')}
      </h2>
      <ul className="list-unstyled mb-0">
        {remaining.map((operation) => {
          const path =
            operation.page?.path ??
            operation.path ??
            operation.toPath ??
            operation.fromPath;
          return (
            <li
              key={operation.key}
              className="d-flex flex-wrap align-items-center gap-2"
            >
              {path != null ? (
                <code className="text-break">{path}</code>
              ) : (
                <span className="text-muted">
                  {t('change_proposal_viewer.operation.page_gone')}
                </span>
              )}
              <span className="badge text-bg-light border">
                {t(OPERATION_STATUS_LABEL_KEYS[operation.status])}
              </span>
              {operation.reason != null && (
                <span className="small text-muted">
                  {t(OPERATION_REASON_LABEL_KEYS[operation.reason])}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
