import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

const ConfirmBotChangeModal = (props) => {
  const { t } = useTranslation('admin');

  const handleCancelButton = () => {
    if (props.onCancelClick != null) {
      props.onCancelClick();
    }
  };

  const handleChangeButton = () => {
    if (props.onConfirmClick != null) {
      props.onConfirmClick();
    }
  };

  return (
    <Modal isOpen={props.isOpen} centered>
      <ModalHeader toggle={handleCancelButton} className="text-danger">
        {t('slack_integration.modal.warning')}
      </ModalHeader>
      <ModalBody>
        <div>
          <h4>{t('slack_integration.modal.sure_change_bot_type')}</h4>
        </div>
        <div>
          <p>{t('slack_integration.modal.changes_will_be_deleted')}</p>
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCancelButton}
        >
          {t('slack_integration.modal.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={handleChangeButton}
        >
          {t('slack_integration.modal.change')}
        </button>
      </ModalFooter>
    </Modal>
  );
};

ConfirmBotChangeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onConfirmClick: PropTypes.func,
  onCancelClick: PropTypes.func,
};

export default ConfirmBotChangeModal;
