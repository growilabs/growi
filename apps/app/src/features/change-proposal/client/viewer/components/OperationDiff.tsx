import { type JSX, useState } from 'react';
import { useTranslation } from 'next-i18next';

import type { OperationView } from '../../../interfaces';
import { useSWRxOperationDiff } from '../stores/use-swrx-operation-diff';
import { UnifiedDiffView } from './UnifiedDiffView';

type OperationDiffProps = { readonly operation: OperationView };

export const OperationDiff = ({
  operation,
}: OperationDiffProps): JSX.Element => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { data, isLoading } = useSWRxOperationDiff(operation, isOpen);

  const renderBody = (): JSX.Element | null => {
    if (!isOpen) {
      return null;
    }
    if (isLoading || data == null) {
      return (
        <p className="text-muted small mt-2 mb-0">
          {t('change_proposal_viewer.operation.diff_loading')}
        </p>
      );
    }
    if (data.type === 'unavailable') {
      return (
        <p className="text-muted small mt-2 mb-0">
          {t('change_proposal_viewer.operation.diff_unavailable')}
        </p>
      );
    }
    return (
      <div className="mt-2">
        <UnifiedDiffView unifiedDiff={data.unifiedDiff} />
      </div>
    );
  };

  return (
    <div>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {t(
          isOpen
            ? 'change_proposal_viewer.operation.hide_diff'
            : 'change_proposal_viewer.operation.show_diff',
        )}
      </button>
      {renderBody()}
    </div>
  );
};
