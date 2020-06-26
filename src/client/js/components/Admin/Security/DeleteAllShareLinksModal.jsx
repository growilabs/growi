import React from 'react';
import PropTypes from 'prop-types';

import { withTranslation } from 'react-i18next';

import {
  Button, Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

const DeleteAllShareLinksModal = React.memo((props) => {
  const { t } = props;

  function closeModal() {
    if (props.onClose == null) {
      return;
    }

    props.onClose();
  }

  function deleteAllLinkHandler() {
    if (props.onClickDeleteButton == null) {
      return;
    }

    props.onClickDeleteButton();

    closeModal();
  }

  function closeButtonHandler() {
    closeModal();
  }

  return (
    <Modal isOpen={props.isOpen} toggle={closeButtonHandler} className="page-comment-delete-modal">
      <ModalHeader tag="h4" toggle={closeButtonHandler} className="bg-danger text-light">
        <span>
          <i className="icon-fw icon-fire"></i>
          {t('delete_all_share_links')}
        </span>
      </ModalHeader>
      <ModalBody>
        { t('share_link_notice', { count: props.count })}
      </ModalBody>
      <ModalFooter>
        <Button onClick={closeButtonHandler}>Cancel</Button>
        <Button color="danger" onClick={deleteAllLinkHandler}>
          <i className="icon icon-fire"></i>
            Delete
        </Button>
      </ModalFooter>
    </Modal>
  );

});

DeleteAllShareLinksModal.propTypes = {
  t: PropTypes.func.isRequired, // i18next

  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func,
  count: PropTypes.number.isRequired,
  onClickDeleteButton: PropTypes.func,
};

export default withTranslation()(DeleteAllShareLinksModal);
