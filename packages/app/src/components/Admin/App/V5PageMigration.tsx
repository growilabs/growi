import React, { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from './ConfirmModal';
import AdminAppContainer from '../../../client/services/AdminAppContainer';
import { withUnstatedContainers } from '../../UnstatedUtils';
import { toastSuccess, toastError } from '../../../client/util/apiNotification';

type Props = {
  adminAppContainer: typeof AdminAppContainer & { v5PageMigrationHandler: () => Promise<{ isV5Compatible: boolean }> },
}

const V5PageMigration: FC<Props> = (props: Props) => {
  const [isV5PageMigrationModalShown, setIsV5PageMigrationModalShown] = useState(false);
  const { adminAppContainer } = props;
  const { t } = useTranslation();

  const onConfirm = async() => {
    setIsV5PageMigrationModalShown(false);
    try {
      const { isV5Compatible } = await adminAppContainer.v5PageMigrationHandler();
      if (isV5Compatible) {

        return toastSuccess(t('admin:v5_page_migration.already_upgraded'));
      }
      toastSuccess(t('admin:v5_page_migration.successfully_started'));
    }
    catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <ConfirmModal
        isModalOpen={isV5PageMigrationModalShown}
        warningMessage={t('admin:v5_page_migration.modal_migration_warning')}
        supplymentaryMessage={t('admin:v5_page_migration.migration_note')}
        confirmButtonTitle={t('admin:v5_page_migration.start_upgrading')}
        onConfirm={onConfirm}
        onCancel={() => setIsV5PageMigrationModalShown(false)}
      />
      <p className="card well">
        {t('admin:v5_page_migration.migration_desc')}
        <br />
        <br />
        <span className="text-danger">
          <i className="icon-exclamation icon-fw"></i>
          {t('admin:v5_page_migration.migration_note')}
        </span>
      </p>
      <div className="row my-3">
        <div className="mx-auto">
          <button type="button" className="btn btn-warning" onClick={() => setIsV5PageMigrationModalShown(true)}>
            {t('admin:v5_page_migration.upgrade_to_v5')}
          </button>
        </div>
      </div>
    </>
  );
};

export default withUnstatedContainers(V5PageMigration, [AdminAppContainer]);
