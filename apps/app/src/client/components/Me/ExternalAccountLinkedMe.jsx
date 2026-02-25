import React, { Fragment } from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import { useSWRxPersonalExternalAccounts } from '~/stores/personal-settings';

import { withUnstatedContainers } from '../UnstatedUtils';
import AssociateModal from './AssociateModal';
import DisassociateModal from './DisassociateModal';
import ExternalAccountRow from './ExternalAccountRow';

class ExternalAccountLinkedMe extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      isAssociateModalOpen: false,
      isDisassociateModalOpen: false,
      accountForDisassociate: null,
    };

    this.openAssociateModal = this.openAssociateModal.bind(this);
    this.closeAssociateModal = this.closeAssociateModal.bind(this);
    this.openDisassociateModal = this.openDisassociateModal.bind(this);
    this.closeDisassociateModal = this.closeDisassociateModal.bind(this);
  }

  openAssociateModal() {
    this.setState({ isAssociateModalOpen: true });
  }

  closeAssociateModal() {
    this.setState({ isAssociateModalOpen: false });
  }

  /**
   * open disassociate modal, and props account
   * @param {object} account
   */
  openDisassociateModal(account) {
    this.setState({
      isDisassociateModalOpen: true,
      accountForDisassociate: account,
    });
  }

  closeDisassociateModal() {
    this.setState({ isDisassociateModalOpen: false });
  }

  render() {
    const { t, personalExternalAccounts } = this.props;

    return (
      <Fragment>
        <h2 className="border-bottom mt-4 pb-2 fs-4">
          {t('admin:user_management.external_accounts')}
        </h2>
        <button
          type="button"
          data-testid="grw-external-account-add-button"
          className="btn btn-outline-secondary btn-sm pull-right mb-2"
          onClick={this.openAssociateModal}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            add_circle
          </span>
          Add
        </button>

        <table className="table table-bordered table-user-list">
          <thead>
            <tr>
              <th width="120px">
                {t('admin:user_management.authentication_provider')}
              </th>
              <th>
                <code>accountId</code>
              </th>
              <th width="200px">{t('Created')}</th>
              <th width="150px">{t('Admin')}</th>
            </tr>
          </thead>
          <tbody>
            {personalExternalAccounts != null &&
              personalExternalAccounts.length > 0 &&
              personalExternalAccounts.map((account) => (
                <ExternalAccountRow
                  account={account}
                  key={account._id}
                  openDisassociateModal={this.openDisassociateModal}
                />
              ))}
          </tbody>
        </table>

        <AssociateModal
          isOpen={this.state.isAssociateModalOpen}
          onClose={this.closeAssociateModal}
        />

        {this.state.accountForDisassociate != null && (
          <DisassociateModal
            isOpen={this.state.isDisassociateModalOpen}
            onClose={this.closeDisassociateModal}
            accountForDisassociate={this.state.accountForDisassociate}
          />
        )}
      </Fragment>
    );
  }
}

ExternalAccountLinkedMe.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  personalExternalAccounts: PropTypes.arrayOf(PropTypes.object),
};

const ExternalAccountLinkedMeWrapperFC = (props) => {
  const { t } = useTranslation();
  const { data: personalExternalAccountsData } =
    useSWRxPersonalExternalAccounts();

  return (
    <ExternalAccountLinkedMe
      t={t}
      personalExternalAccounts={personalExternalAccountsData}
      {...props}
    />
  );
};

export default ExternalAccountLinkedMeWrapperFC;
