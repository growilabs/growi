import React from 'react';

import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useIsMailerSetup } from '~/stores/context';


class PasswordResetModal extends React.Component {

  constructor(props) {
    super(props);

    this.state = {
      temporaryPassword: [],
      isPasswordResetDone: false,
      sendEmail: false,
    };

    this.resetPassword = this.resetPassword.bind(this);
    this.handleCheckBox = this.handleCheckBox.bind(this);
  }

  async resetPassword() {
    const { t, userForPasswordResetModal } = this.props;
    try {
      const res = await apiv3Put('/users/reset-password', { id: userForPasswordResetModal._id });
      const { newPassword, failedToSendEmail } = res.data;
      if (failedToSendEmail == null) {
        const msg = `Email has been sent<br>・${userForPasswordResetModal.email}`;
        toastSuccess(msg);
      }
      else {
        const msg = { message: `email: ${failedToSendEmail.email}<br>reason: ${failedToSendEmail.reason}` };
        toastError(msg);
      }
      this.setState({ temporaryPassword: newPassword, isPasswordResetDone: true });
    }
    catch (err) {
      toastError(err);
    }
  }

  renderModalBodyBeforeReset() {
    const { t, userForPasswordResetModal } = this.props;

    return (
      <>
        <p>
          {t('user_management.reset_password_modal.password_never_seen')}<br />
          <span className="text-danger">{t('user_management.reset_password_modal.send_new_password')}</span>
        </p>
        <p>
          {t('user_management.reset_password_modal.target_user')}: <code>{userForPasswordResetModal.email}</code>
        </p>
      </>
    );
  }

  returnModalBodyAfterReset() {
    const { t, userForPasswordResetModal } = this.props;

    return (
      <>
        <p className="text-danger">{t('user_management.reset_password_modal.password_reset_message')}</p>
        <p>
          {t('user_management.reset_password_modal.target_user')}: <code>{userForPasswordResetModal.email}</code>
        </p>
        <p>
          {t('user_management.reset_password_modal.new_password')}: <code>{this.state.temporaryPassword}</code>
        </p>
      </>
    );
  }

  returnModalFooterBeforeReset() {
    const { t, isMailerSetup } = this.props;
    return (
      <>
        <div className="col text-left custom-control custom-checkbox custom-checkbox-info text-left" onChange={this.handleCheckBox}>
          <input
            type="checkbox"
            id="sendEmail"
            className="custom-control-input"
            name="sendEmail"
            defaultChecked={this.state.sendEmail}
            disabled={!isMailerSetup}
          />
          <label className="custom-control-label" htmlFor="sendEmail">
            {t('admin:user_management.reset_password_modal.send_password_email')}
          </label>
          {isMailerSetup
            // eslint-disable-next-line react/no-danger
            ? <p className="form-text text-muted" dangerouslySetInnerHTML={{ __html: t('admin:user_management.reset_password_modal.mail_setting_link') }} />
            // eslint-disable-next-line react/no-danger
            : <p className="form-text text-muted" dangerouslySetInnerHTML={{ __html: t('admin:mailer_setup_required') }} />
          }
        </div>
        <div>
          <button type="submit" className="btn btn-danger" onClick={this.resetPassword}>
            {t('user_management.reset_password')}
          </button>
        </div>
      </>
    );
  }

  returnModalFooterAfterReset() {
    const { t } = this.props;

    return (
      <button type="submit" className="btn btn-primary" onClick={this.props.onClose}>
        {t('Close')}
      </button>
    );
  }


  handleCheckBox() {
    this.setState({ sendEmail: !this.state.sendEmail });
  }

  render() {
    const { t } = this.props;

    return (
      <Modal isOpen={this.props.isOpen} toggle={this.props.onClose}>
        <ModalHeader tag="h4" toggle={this.props.onClose} className="bg-warning text-light">
          {t('user_management.reset_password') }
        </ModalHeader>
        <ModalBody>
          {this.state.isPasswordResetDone ? this.returnModalBodyAfterReset() : this.renderModalBodyBeforeReset()}
        </ModalBody>
        <ModalFooter>
          {this.state.isPasswordResetDone ? this.returnModalFooterAfterReset() : this.returnModalFooterBeforeReset()}
        </ModalFooter>
      </Modal>
    );
  }

}

const PasswordResetModalWrapperFC = (props) => {
  const { t } = useTranslation('admin');
  const { data: isMailerSetup } = useIsMailerSetup();
  return <PasswordResetModal t={t} isMailerSetup={isMailerSetup ?? false} {...props} />;
};

/**
 * Wrapper component for using unstated
 */

PasswordResetModal.propTypes = {
  t: PropTypes.func.isRequired, // i18next

  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  userForPasswordResetModal: PropTypes.object,

};

export default PasswordResetModalWrapperFC;
