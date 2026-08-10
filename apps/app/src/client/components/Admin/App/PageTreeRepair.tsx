import type { FC } from 'react';
import { useState } from 'react';
import { useTranslation } from 'next-i18next';

import { toastError, toastSuccess } from '~/client/util/toastr';
import { useIsMaintenanceMode } from '~/states/global';

import AdminAppContainer from '../../../services/AdminAppContainer';
import { withUnstatedContainers } from '../../UnstatedUtils';
import { ConfirmModal } from './ConfirmModal';

type Props = {
  adminAppContainer: AdminAppContainer;
};

const PageTreeRepair: FC<Props> = (props: Props) => {
  const [isModalShown, setIsModalShown] = useState(false);
  const [isStarted, setIsStarted] = useState(false);

  const { t } = useTranslation();
  const { adminAppContainer } = props;

  // The endpoint rejects a repair outside maintenance mode, so without this the only
  // way to discover the precondition is to press the button and read the error toast.
  // `repair_note` in the card below is what explains the disabled state.
  const isMaintenanceMode = useIsMaintenanceMode();

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
        // repair_note is already on the card behind this modal
        supplymentaryMessage={null}
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
            disabled={isStarted || !isMaintenanceMode}
          >
            {t('admin:page_tree_repair.repair_page_tree')}
          </button>
        </div>
      </div>
    </>
  );
};

export default withUnstatedContainers(PageTreeRepair, [AdminAppContainer]);
