import type { FC, JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalHeader } from 'reactstrap';

import LabeledProgressBar from '~/client/components/Admin/Common/LabeledProgressBar';
import { apiv3Get } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { ExternalGroupProviderType } from '~/features/external-user-group/interfaces/external-user-group';
import { SocketEventName } from '~/interfaces/websocket';
import { useAdminSocket } from '~/stores/socket-io';

import { useSWRxExternalUserGroupList } from '../../stores/external-user-group';

type SyncExecutionProps = {
  provider: ExternalGroupProviderType;
  requestSyncAPI: (e?: React.FormEvent<HTMLFormElement>) => Promise<void>;
  AdditionalForm?: FC;
};

enum SyncStatus {
  beforeSync,
  syncExecuting,
  syncCompleted,
  syncFailed,
}

export const SyncExecution = ({
  provider,
  requestSyncAPI,
  AdditionalForm = () => <></>,
}: SyncExecutionProps): JSX.Element => {
  const { t } = useTranslation('admin');
  const { data: socket } = useAdminSocket();
  const { mutate: mutateExternalUserGroups } = useSWRxExternalUserGroupList();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    SyncStatus.beforeSync,
  );
  const [progress, setProgress] = useState({
    total: 0,
    current: 0,
  });
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  // value to propagate the submit event of form to submit confirm modal
  const [currentSubmitEvent, setCurrentSubmitEvent] =
    useState<React.FormEvent<HTMLFormElement>>();

  useEffect(() => {
    if (socket == null) return;

    const eventName = SocketEventName.externalUserGroup[provider];

    socket.on(eventName.GroupSyncProgress, (data) => {
      setSyncStatus(SyncStatus.syncExecuting);
      setProgress({
        total: data.totalCount,
        current: data.count,
      });
    });

    socket.on(eventName.GroupSyncCompleted, () => {
      setSyncStatus(SyncStatus.syncCompleted);
      mutateExternalUserGroups();
      toastSuccess(t('external_user_group.sync_succeeded'));
    });

    socket.on(eventName.GroupSyncFailed, () => {
      setSyncStatus(SyncStatus.syncFailed);
      mutateExternalUserGroups();
      toastError(t('external_user_group.sync_failed'));
    });

    return () => {
      socket.off(eventName.GroupSyncProgress);
      socket.off(eventName.GroupSyncCompleted);
      socket.off(eventName.GroupSyncFailed);
    };
  }, [socket, mutateExternalUserGroups, t, provider]);

  // get sync status on load, since next socket data may take a while
  useEffect(() => {
    const getSyncStatus = async () => {
      const res = await apiv3Get(
        `/external-user-groups/${provider}/sync-status`,
      );
      if (res.data.isExecutingSync) {
        setSyncStatus(SyncStatus.syncExecuting);
        setProgress({ total: res.data.totalCount, current: res.data.count });
      }
    };
    getSyncStatus();
  }, [provider]);

  const onSyncBtnClick = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCurrentSubmitEvent(e);
    setIsAlertModalOpen(true);
  };

  const onSyncExecConfirmBtnClick = useCallback(async () => {
    setIsAlertModalOpen(false);
    try {
      // set sync status before requesting to API, so that setting to syncFailed does not get overwritten
      setSyncStatus(SyncStatus.syncExecuting);
      setProgress({ total: 0, current: 0 });
      await requestSyncAPI(currentSubmitEvent);
    } catch (errs) {
      setSyncStatus(SyncStatus.syncFailed);
      toastError(t(errs[0]?.code));
    }
  }, [t, requestSyncAPI, currentSubmitEvent]);

  const renderProgressBar = () => {
    if (syncStatus === SyncStatus.beforeSync) return null;

    let header: string;
    if (syncStatus === SyncStatus.syncExecuting) {
      header = 'Processing..';
    } else if (syncStatus === SyncStatus.syncCompleted) {
      header = 'Completed';
    } else {
      header = 'Failed';
    }

    return (
      <LabeledProgressBar
        header={header}
        currentCount={progress.current}
        totalCount={progress.total}
      />
    );
  };

  return (
    <>
      <h3 className="border-bottom mb-3">
        {t('external_user_group.execute_sync')}
      </h3>
      <div className="row">
        <div className="col-md-3"></div>
        <div className="col-md-9">{renderProgressBar()}</div>
      </div>
      <form onSubmit={onSyncBtnClick}>
        <AdditionalForm />
        <div className="row">
          <div className="col-md-3"></div>
          <div className="col-md-6">
            <button className="btn btn-primary" type="submit">
              {t('external_user_group.sync')}
            </button>
          </div>
        </div>
      </form>

      <Modal
        isOpen={isAlertModalOpen}
        toggle={() => setIsAlertModalOpen(false)}
      >
        <ModalHeader
          tag="h4"
          toggle={() => setIsAlertModalOpen(false)}
          className="text-info"
        >
          <span className="material-symbols-outlined me-1 align-middle">
            error
          </span>
          <span className="align-middle">
            {t('external_user_group.confirmation_before_sync')}
          </span>
        </ModalHeader>
        <ModalBody>
          <ul>
            <li>{t('external_user_group.execution_time_warning')}</li>
            <li>{t('external_user_group.parallel_sync_forbidden')}</li>
          </ul>
          <div className="text-center">
            <button
              className="btn btn-primary"
              type="button"
              onClick={onSyncExecConfirmBtnClick}
            >
              {t('Execute')}
            </button>
          </div>
        </ModalBody>
      </Modal>
    </>
  );
};
