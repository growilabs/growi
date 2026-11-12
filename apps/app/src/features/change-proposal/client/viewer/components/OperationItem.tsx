import type { JSX } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import type { OperationView } from '../../../interfaces';
import {
  buildProposalHref,
  formatProposalShortId,
  OPERATION_REASON_LABEL_KEYS,
  OPERATION_STATUS_LABEL_KEYS,
  OPERATION_TYPE_LABEL_KEYS,
  REVERT_REFUSAL_REASON_LABEL_KEYS,
} from '../../shared';
import { toDiffPair } from '../stores/use-swrx-operation-diff';
import { OperationDiff } from './OperationDiff';

type OperationItemProps = { readonly operation: OperationView };

const PathText = ({ value }: { readonly value: string }): JSX.Element => (
  <code className="text-break">{value}</code>
);

export const OperationItem = ({
  operation,
}: OperationItemProps): JSX.Element => {
  const { t } = useTranslation();
  const { type, status, reason, revertability, revertedByProposalId } =
    operation;

  const renderPaths = (): JSX.Element => {
    if (
      type === 'move' &&
      (operation.fromPath != null || operation.toPath != null)
    ) {
      return (
        <span>
          {operation.fromPath != null && (
            <PathText value={operation.fromPath} />
          )}
          <span className="mx-1">→</span>
          {operation.toPath != null && <PathText value={operation.toPath} />}
        </span>
      );
    }
    const path = operation.page?.path ?? operation.path;
    if (path == null) {
      return (
        <span className="text-muted">
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
    return (
      <span className="small text-muted">
        {revertability.revertible
          ? t('change_proposal_viewer.operation.revertible')
          : t(REVERT_REFUSAL_REASON_LABEL_KEYS[revertability.reason])}
      </span>
    );
  };

  return (
    <div className="border rounded p-2 mb-2">
      <div className="d-flex flex-wrap align-items-center gap-2">
        {operation.index != null && (
          <span className="text-muted small">{`#${operation.index + 1}`}</span>
        )}
        <span className="badge text-bg-light border">
          {t(OPERATION_TYPE_LABEL_KEYS[type])}
        </span>
        {renderPaths()}
        <span className="badge text-bg-secondary">
          {t(OPERATION_STATUS_LABEL_KEYS[status])}
        </span>
        {reason != null && (
          <span className="small text-muted">
            {t(OPERATION_REASON_LABEL_KEYS[reason])}
          </span>
        )}
        {renderRevertability()}
        {revertedByProposalId != null && (
          <span className="small">
            {t('change_proposal_viewer.operation.reverted_by')}{' '}
            <Link href={buildProposalHref(revertedByProposalId)}>
              {formatProposalShortId(revertedByProposalId)}
            </Link>
          </span>
        )}
      </div>
      {toDiffPair(operation).type !== 'no-diff' && (
        <div className="mt-2">
          <OperationDiff operation={operation} />
        </div>
      )}
    </div>
  );
};
