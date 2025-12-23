import type { FC } from 'react';
import React, { useCallback, useEffect, useState } from 'react';

import { useTranslation } from 'next-i18next';

import { toastError, toastSuccess } from '~/client/util/toastr';
import { useAdminSocket } from '~/features/admin/states/socket-io';
import type {
  PMStartedData, PMMigratingData, PMErrorCountData, PMEndedData,
} from '~/interfaces/websocket';
import {
  SocketEventName,
} from '~/interfaces/websocket';

import AdminAppContainer from '../../../services/AdminAppContainer';
import { withUnstatedContainers } from '../../UnstatedUtils';
import LabeledProgressBar from '../Common/LabeledProgressBar';

import { ConfirmModal } from './ConfirmModal';


type Props = {
  adminAppContainer: typeof AdminAppContainer & { v5PageMigrationHandler: () => Promise<{ isV5Compatible: boolean }> },
}

const V5PageMigration: FC<Props> = (props: Props) => {
  // Modal
  const [isV5PageMigrationModalShown, setIsV5PageMigrationModalShown] = useState(false);
  // Progress bar
  const [isInProgress, setProgressing] = useState<boolean | undefined>(undefined); // use false as ended
  const [total, setTotal] = useState<number>(0);
  const [skip, setSkip] = useState<number>(0);
  const [current, setCurrent] = useState<number>(0);
  const [isSucceeded, setSucceeded] = useState<boolean | undefined>(undefined);

  const adminSocket = useAdminSocket();
  const { t } = useTranslation();

  const { adminAppContainer } = props;

  /*
   * Local components
   */
  const renderResultMessage = useCallback((isSucceeded: boolean) => {
    return (
      <>
        {
          isSucceeded
            ? <p className="text-success p-1">{t('admin:v5_page_migration.migration_succeeded')}</p>
            : <p className="text-danger p-1">{t('admin:v5_page_migration.migration_failed')}</p>
        }
      </>
    );
  }, [t]);

  const renderProgressBar = () => {
    if (isInProgress == null) {
      return <></>;
    }

    return (
      <>
        {
          isSucceeded != null && renderResultMessage(isSucceeded)
        }
        <LabeledProgressBar
          header={t('admin:v5_page_migration.header_upgrading_progress')}
          currentCount={current}
          totalCount={total}
          isInProgress={isInProgress}
        />
      </>
    );
  };

  /*
   * Functions
   */
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

  /*
   * Use Effect
   */
  // Setup Admin Socket
  useEffect(() => {
    adminSocket?.once(SocketEventName.PMStarted, (data: PMStartedData) => {
      setProgressing(true);
      setTotal(data.total);
    });

    adminSocket?.on(SocketEventName.PMMigrating, (data: PMMigratingData) => {
      setProgressing(true);
      setCurrent(data.count);
    });

    adminSocket?.on(SocketEventName.PMErrorCount, (data: PMErrorCountData) => {
      setProgressing(true);
      setSkip(data.skip);
    });

    adminSocket?.once(SocketEventName.PMEnded, (data: PMEndedData) => {
      setProgressing(false);
      setSucceeded(data.isSucceeded);
    });

    return () => {
      adminSocket?.off(SocketEventName.PMStarted);
      adminSocket?.off(SocketEventName.PMMigrating);
      adminSocket?.off(SocketEventName.PMErrorCount);
      adminSocket?.off(SocketEventName.PMEnded);
    };
  }, [adminSocket]);

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
      <p className="card custom-card">
        {t('admin:v5_page_migration.migration_desc')}
        <br />
        <br />
        <span className="text-danger">
          <span className="material-symbols-outlined">error</span>
          {t('admin:v5_page_migration.migration_note')}
        </span>
      </p>
      {renderProgressBar()}
      <div className="row my-3">
        <div className="mx-auto">
          <button type="button" className="btn btn-warning" onClick={() => setIsV5PageMigrationModalShown(true)} disabled={isInProgress != null}>
            {t('admin:v5_page_migration.upgrade_to_v5')}
          </button>
        </div>
      </div>
    </>
  );
};

export default withUnstatedContainers(V5PageMigration, [AdminAppContainer]);
