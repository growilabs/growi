import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

const SendInvitationEmailButton = (props) => {
  const { user, isInvitationEmailSended, onSuccessfullySentInvitationEmail } =
    props;
  const { t } = useTranslation();

  const textColor = !isInvitationEmailSended ? 'text-danger' : '';

  const onClickSendInvitationEmailButton = async () => {
    try {
      const res = await apiv3Put('/users/send-invitation-email', {
        id: user._id,
      });
      const { failedToSendEmail } = res.data;
      if (failedToSendEmail == null) {
        const msg = `Email has been sent<br>・${user.email}`;
        toastSuccess(msg);
        onSuccessfullySentInvitationEmail();
      } else {
        const msg = {
          message: `email: ${failedToSendEmail.email}<br>reason: ${failedToSendEmail.reason}`,
        };
        toastError(msg);
      }
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <button
      className={`dropdown-item ${textColor}`}
      type="button"
      onClick={() => {
        onClickSendInvitationEmailButton();
      }}
    >
      <span className="material-symbols-outlined me-1">mail</span>
      {isInvitationEmailSended && (
        <>{t('admin:user_management.user_table.resend_invitation_email')}</>
      )}
      {!isInvitationEmailSended && (
        <>{t('admin:user_management.user_table.send_invitation_email')}</>
      )}
    </button>
  );
};

/**
 * @type {React.ComponentType<{ user: import('@growi/core').IUserHasId, isInvitationEmailSended: boolean, onSuccessfullySentInvitationEmail: () => void }>}
 */
const SendInvitationEmailButtonWrapper = withUnstatedContainers(
  SendInvitationEmailButton,
  [AdminUsersContainer],
);

SendInvitationEmailButton.propTypes = {
  user: PropTypes.object.isRequired,
  isInvitationEmailSended: PropTypes.bool.isRequired,
  onSuccessfullySentInvitationEmail: PropTypes.func.isRequired,
};

export default SendInvitationEmailButtonWrapper;
