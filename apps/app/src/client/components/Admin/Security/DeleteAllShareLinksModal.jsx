import React, { useCallback } from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

const DeleteAllShareLinksModal = React.memo((props) => {
  const { t, onClickDeleteButton, onClose } = props;

  const deleteAllLinkHandler = useCallback(() => {
    onClickDeleteButton?.();
    onClose?.();
  }, [onClickDeleteButton, onClose]);

  const closeButtonHandler = useCallback(() => {
    onClose?.();
  }, [onClose]);

  return (
    <Modal
      isOpen={props.isOpen}
      toggle={closeButtonHandler}
      className="page-comment-delete-modal"
    >
      <ModalHeader tag="h4" toggle={closeButtonHandler} className="text-danger">
        <span>
          <span className="material-symbols-outlined">delete_forever</span>
          {t('security_settings.delete_all_share_links')}
        </span>
      </ModalHeader>
      <ModalBody>{t('security_settings.share_link_notice')}</ModalBody>
      <ModalFooter>
        <Button onClick={closeButtonHandler}>{t('Cancel')}</Button>
        <Button color="danger" onClick={deleteAllLinkHandler}>
          <span className="material-symbols-outlined">delete_forever</span>
          {t('Delete')}
        </Button>
      </ModalFooter>
    </Modal>
  );
});
DeleteAllShareLinksModal.displayName = 'DeleteAllShareLinksModal';

DeleteAllShareLinksModal.propTypes = {
  t: PropTypes.func.isRequired, // i18next

  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func,
  onClickDeleteButton: PropTypes.func,
};

// biome-ignore lint:*:noExplicitModuleBoundaryTypes: Temporary Alternative to @typescript-eslint/explicit-module-boundary-types
const DeleteAllShareLinksModalWrapperFC = (props) => {
  const { t } = useTranslation('admin');

  return <DeleteAllShareLinksModal t={t} {...props} />;
};

export default DeleteAllShareLinksModalWrapperFC;
