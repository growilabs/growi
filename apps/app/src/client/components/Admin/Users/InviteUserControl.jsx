import React, { Fragment } from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';

import { withUnstatedContainers } from '../../UnstatedUtils';
import UserInviteModal from './UserInviteModal';

class InviteUserControl extends React.Component {
  render() {
    const { t, adminUsersContainer } = this.props;

    return (
      <Fragment>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={adminUsersContainer.toggleUserInviteModal}
        >
          {t('admin:user_management.invite_users')}
        </button>
        <UserInviteModal />
      </Fragment>
    );
  }
}

InviteUserControl.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  adminUsersContainer: PropTypes.instanceOf(AdminUsersContainer).isRequired,
};

const InviteUserControlWrapperFC = (props) => {
  const { t } = useTranslation();
  return <InviteUserControl t={t} {...props} />;
};

/**
 * Wrapper component for using unstated
 */
const InviteUserControlWrapper = withUnstatedContainers(
  InviteUserControlWrapperFC,
  [AdminUsersContainer],
);

export default InviteUserControlWrapper;
