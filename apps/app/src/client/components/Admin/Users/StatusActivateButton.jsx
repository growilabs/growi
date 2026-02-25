import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastError, toastSuccess } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

class StatusActivateButton extends React.Component {
  constructor(props) {
    super(props);

    this.onClickAcceptBtn = this.onClickAcceptBtn.bind(this);
  }

  async onClickAcceptBtn() {
    const { t } = this.props;

    try {
      const username = await this.props.adminUsersContainer.activateUser(
        this.props.user._id,
      );
      toastSuccess(t('toaster.activate_user_success', { username }));
    } catch (err) {
      toastError(err);
    }
  }

  render() {
    const { t } = this.props;

    return (
      <button
        className="dropdown-item"
        type="button"
        onClick={() => {
          this.onClickAcceptBtn();
        }}
      >
        <span className="material-symbols-outlined me-1">person_add</span>
        {t('user_management.user_table.accept')}
      </button>
    );
  }
}

const StatusActivateFormWrapperFC = (props) => {
  const { t } = useTranslation('admin');
  return <StatusActivateButton t={t} {...props} />;
};

/**
 * Wrapper component for using unstated
 * @type {React.ComponentType<{ user: import('@growi/core').IUserHasId }>}
 */
const StatusActivateFormWrapper = withUnstatedContainers(
  StatusActivateFormWrapperFC,
  [AdminUsersContainer],
);

StatusActivateButton.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  adminUsersContainer: PropTypes.instanceOf(AdminUsersContainer).isRequired,

  user: PropTypes.object.isRequired,
};

export default StatusActivateFormWrapper;
