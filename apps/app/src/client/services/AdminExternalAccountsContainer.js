import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import loggerFactory from '~/utils/logger';

import { apiv3Delete, apiv3Get } from '../util/apiv3-client';

// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:services:AdminexternalaccountsContainer');

/**
 * Service container for admin external-accounts page (ManageExternalAccountsContainer.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminExternalAccountsContainer extends Container {
  constructor() {
    super();

    if (isServer()) {
      return;
    }

    this.state = {
      externalAccounts: [],
      totalAccounts: 0,
      activePage: 1,
      pagingLimit: Infinity,
    };
  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminExternalAccountsContainer';
  }

  /**
   * syncExternalAccounts of selectedPage
   * @memberOf AdminExternalAccountsContainer
   * @param {number} selectedPage
   */
  async retrieveExternalAccountsByPagingNum(selectedPage) {
    const params = { page: selectedPage };
    const { data } = await apiv3Get('/users/external-accounts', params);

    if (data.paginateResult == null) {
      throw new Error("data must conclude 'paginateResult' property.");
    }
    const {
      docs: externalAccounts,
      totalDocs: totalAccounts,
      limit: pagingLimit,
    } = data.paginateResult;
    this.setState({
      externalAccounts,
      totalAccounts,
      pagingLimit,
      activePage: selectedPage,
    });
  }

  /**
   * remove external account
   *
   * @memberOf AdminExternalAccountsContainer
   * @param {string} externalAccountId id of the External Account to be removed
   */
  async removeExternalAccountById(externalAccountId) {
    const res = await apiv3Delete(
      `/users/external-accounts/${externalAccountId}/remove`,
    );
    const deletedUserData = res.data.externalAccount;
    await this.retrieveExternalAccountsByPagingNum(this.state.activePage);
    return deletedUserData.accountId;
  }
}
