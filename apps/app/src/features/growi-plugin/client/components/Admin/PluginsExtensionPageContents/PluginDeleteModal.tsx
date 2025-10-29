import type React from 'react';
import { useCallback } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import { apiv3Delete } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import {
  usePluginDeleteModal,
  useSWRxAdminPlugins,
} from '../../../stores/admin-plugins';

export const PluginDeleteModal: React.FC = () => {
  const { t } = useTranslation('admin');
  const { mutate } = useSWRxAdminPlugins();
  const { data: pluginDeleteModalData, close: closePluginDeleteModal } =
    usePluginDeleteModal();
  const isOpen = pluginDeleteModalData?.isOpen;
  const id = pluginDeleteModalData?.id;
  const name = pluginDeleteModalData?.name;
  const url = pluginDeleteModalData?.url;

  const toggleHandler = useCallback(() => {
    closePluginDeleteModal();
  }, [closePluginDeleteModal]);

  const onClickDeleteButtonHandler = useCallback(async () => {
    const reqUrl = `/plugins/${id}/remove`;

    try {
      const res = await apiv3Delete(reqUrl);
      const pluginName = res.data.pluginName;
      closePluginDeleteModal();
      toastSuccess(t('toaster.remove_plugin_success', { pluginName }));
      mutate();
    } catch (err) {
      toastError(err);
    }
  }, [id, closePluginDeleteModal, t, mutate]);

  return (
    <Modal isOpen={isOpen} toggle={toggleHandler}>
      <ModalHeader
        tag="h4"
        toggle={toggleHandler}
        className="text-danger"
        name={name}
      >
        <span>
          <span className="material-symbols-outlined">delete_forever</span>
          {t('plugins.confirm')}
        </span>
      </ModalHeader>
      <ModalBody>
        <div className="card well mt-2 p-2" key={id}>
          <Link href={`${url}`} legacyBehavior>
            {name}
          </Link>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button color="danger" onClick={onClickDeleteButtonHandler}>
          <span className="material-symbols-outlined">delete_forever</span>
          {t('Delete')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
