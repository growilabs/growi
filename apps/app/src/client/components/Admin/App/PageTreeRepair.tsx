import type { FC } from 'react';
import { useState } from 'react';
import { useTranslation } from 'next-i18next';

import { toastError, toastSuccess } from '~/client/util/toastr';

import AdminAppContainer from '../../../services/AdminAppContainer';
import { withUnstatedContainers } from '../../UnstatedUtils';
import { ConfirmModal } from './ConfirmModal';

type Props = {
  adminAppContainer: typeof AdminAppContainer & {
    repairPageTreeHandler: () => Promise<{ isStarted: boolean }>;
  };
};

const PageTreeRepair: FC<Props> = (props: Props) => {
  const [isModalShown, setIsModalShown] = useState(false);
  const [isStarted, setIsStarted] = useState(false);

  const { t } = useTranslation();
  const { adminAppContainer } = props;

  const onConfirm = async () => {
    setIsModalShown(false);
    try {
      await adminAppContainer.repairPageTreeHandler();
      setIsStarted(true);
      toastSuccess(t('admin:page_tree_repair.successfully_started'));
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <ConfirmModal
        isModalOpen={isModalShown}
        warningMessage={t('admin:page_tree_repair.modal_repair_warning')}
        supplymentaryMessage={t('admin:page_tree_repair.repair_note')}
        confirmButtonTitle={t('admin:page_tree_repair.start_repair')}
        onConfirm={onConfirm}
        onCancel={() => setIsModalShown(false)}
      />
      <p className="card custom-card">
        {t('admin:page_tree_repair.repair_desc')}
        <br />
        <br />
        <span className="text-danger">
          <span className="material-symbols-outlined">error</span>
          {t('admin:page_tree_repair.repair_note')}
        </span>
      </p>
      {isStarted && (
        <p className="text-success p-1">
          {t('admin:page_tree_repair.repair_in_progress')}
        </p>
      )}
      <div className="row my-3">
        <div className="mx-auto">
          <button
            type="button"
            className="btn btn-warning"
            onClick={() => setIsModalShown(true)}
            disabled={isStarted}
          >
            {t('admin:page_tree_repair.repair_page_tree')}
          </button>
        </div>
      </div>
    </>
  );
};

export default withUnstatedContainers(PageTreeRepair, [AdminAppContainer]);
