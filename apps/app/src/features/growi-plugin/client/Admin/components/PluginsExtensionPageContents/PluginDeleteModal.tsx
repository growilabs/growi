import type React from 'react';
import { useCallback } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import { apiv3Delete } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import {
  usePluginDeleteModalActions,
  usePluginDeleteModalStatus,
} from '../../states/modal/plugin-delete';
import { useSWRxAdminPlugins } from '../../stores/admin-plugins';

/**
 * PluginDeleteModalSubstance - Presentation component (all logic here)
 */
type PluginDeleteModalSubstanceProps = {
  id: string;
  name: string;
  url: string;
  closeModal: () => void;
};

const PluginDeleteModalSubstance = ({
  id,
  name,
  url,
  closeModal,
}: PluginDeleteModalSubstanceProps): React.JSX.Element => {
  const { t } = useTranslation('admin');
  const { mutate } = useSWRxAdminPlugins();

  const toggleHandler = useCallback(() => {
    closeModal();
  }, [closeModal]);

  const onClickDeleteButtonHandler = useCallback(async () => {
    const reqUrl = `/plugins/${id}/remove`;

    try {
      const res = await apiv3Delete(reqUrl);
      const pluginName = res.data.pluginName;
      closeModal();
      toastSuccess(t('toaster.remove_plugin_success', { pluginName }));
      mutate();
    } catch (err) {
      toastError(err);
    }
  }, [id, closeModal, t, mutate]);

  return (
    <div>
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
    </div>
  );
};

/**
 * PluginDeleteModal - Container component (lightweight, always rendered)
 */
export const PluginDeleteModal: React.FC = () => {
  const pluginDeleteModalData = usePluginDeleteModalStatus();
  const { close: closeModal } = usePluginDeleteModalActions();
  const isOpen = pluginDeleteModalData.isOpened;

  return (
    <Modal isOpen={isOpen} toggle={closeModal}>
      {isOpen && pluginDeleteModalData.id != null && (
        <PluginDeleteModalSubstance
          id={pluginDeleteModalData.id}
          name={pluginDeleteModalData.name ?? ''}
          url={pluginDeleteModalData.url ?? ''}
          closeModal={closeModal}
        />
      )}
    </Modal>
  );
};
