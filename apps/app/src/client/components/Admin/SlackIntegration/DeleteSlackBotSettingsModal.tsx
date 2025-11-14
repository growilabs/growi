import React, { useCallback, useMemo } from 'react';

import { useTranslation } from 'next-i18next';
import {
  Button, Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

type DeleteSlackBotSettingsModalProps = {
  isResetAll: boolean,
  isOpen: boolean,
  onClose?: () => void,
  onClickDeleteButton?: () => void,
}

export const DeleteSlackBotSettingsModal = React.memo((props: DeleteSlackBotSettingsModalProps) => {

  const { t } = useTranslation();

  const {
    isResetAll, isOpen, onClose, onClickDeleteButton,
  } = props;

  const deleteSlackCredentialsHandler = useCallback(() => {
    onClickDeleteButton?.();
    onClose?.();
  }, [onClickDeleteButton, onClose]);

  const closeButtonHandler = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // Memoize conditional content
  const headerContent = useMemo(() => {
    if (isResetAll) {
      return (
        <>
          <span className="material-symbols-outlined">delete_forever</span>
          {t('admin:slack_integration.reset_all_settings')}
        </>
      );
    }
    return (
      <>
        <span className="material-symbols-outlined">delete</span>
        {t('admin:slack_integration.delete_slackbot_settings')}
      </>
    );
  }, [isResetAll, t]);

  const bodyContent = useMemo(() => {
    const htmlContent = isResetAll
      ? t('admin:slack_integration.all_settings_of_the_bot_will_be_reset')
      : t('admin:slack_integration.slackbot_settings_notice');
    return (
      <span
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    );
  }, [isResetAll, t]);

  const deleteButtonContent = useMemo(() => {
    if (isResetAll) {
      return (
        <>
          <span className="material-symbols-outlined">delete_forever</span>
          {t('admin:slack_integration.reset')}
        </>
      );
    }
    return (
      <>
        <span className="material-symbols-outlined">delete</span>
        {t('admin:slack_integration.delete')}
      </>
    );
  }, [isResetAll, t]);

  // Early return optimization
  if (!isOpen) {
    return <></>;
  }

  return (
    <Modal isOpen={isOpen} toggle={closeButtonHandler} className="page-comment-delete-modal">
      <ModalHeader tag="h4" toggle={closeButtonHandler} className="text-danger">
        <span>{headerContent}</span>
      </ModalHeader>
      <ModalBody>
        {bodyContent}
      </ModalBody>
      <ModalFooter>
        <Button onClick={closeButtonHandler}>{t('Cancel')}</Button>
        <Button color="danger" onClick={deleteSlackCredentialsHandler}>
          {deleteButtonContent}
        </Button>
      </ModalFooter>
    </Modal>
  );

});

DeleteSlackBotSettingsModal.displayName = 'DeleteSlackBotSettingsModal';
