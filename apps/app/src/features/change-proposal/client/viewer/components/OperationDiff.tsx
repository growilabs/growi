import { type JSX, useState } from 'react';
import { useTranslation } from 'next-i18next';

import type { OperationView } from '../../../interfaces';
import { useSWRxOperationDiff } from '../stores/use-swrx-operation-diff';
import { SymbolIcon } from './SymbolIcon';
import { UnifiedDiffView } from './UnifiedDiffView';

import styles from './OperationDiff.module.scss';

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
        <p className={styles.message}>
          <span
            className="spinner-border spinner-border-sm"
            aria-hidden="true"
          />
          {t('change_proposal_viewer.operation.diff_loading')}
        </p>
      );
    }
    if (data.type === 'unavailable') {
      return (
        <p className={styles.message}>
          <SymbolIcon name="visibility_off" className={styles.icon} />
          {t('change_proposal_viewer.operation.diff_unavailable')}
        </p>
      );
    }
    return <UnifiedDiffView unifiedDiff={data.unifiedDiff} />;
  };

  return (
    <div className={styles.diff}>
      <button
        type="button"
        className={`btn btn-sm btn-outline-secondary ${styles.toggle}`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <SymbolIcon name="expand_more" className={styles.chevron} />
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
