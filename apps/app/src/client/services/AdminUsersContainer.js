import { isServer } from '@growi/core/dist/utils';
import { debounce } from 'throttle-debounce';
import { Container } from 'unstated';

import {
  apiv3Delete,
  apiv3Get,
  apiv3Post,
  apiv3Put,
} from '../util/apiv3-client';

/**
 * Service container for admin users page (Users.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminUsersContainer extends Container {
  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;

    this.state = {
      users: [],
      sort: 'id',
      sortOrder: 'asc',
      isPasswordResetModalShown: false,
      isUserInviteModalShown: false,
      userForPasswordResetModal: null,
      totalUsers: 0,
      activePage: 1,
      pagingLimit: Infinity,
      selectedStatusList: new Set(['all']),
      searchText: '',
      userStatistics: null,
    };

    this.showPasswordResetModal = this.showPasswordResetModal.bind(this);
    this.hidePasswordResetModal = this.hidePasswordResetModal.bind(this);
    this.toggleUserInviteModal = this.toggleUserInviteModal.bind(this);

    this.handleChangeSearchTextDebouce = debounce(3000, () =>
      this.retrieveUsersByPagingNum(1),
    );
  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminUsersContainer';
  }

  /**
   * Workaround for status list
   */
  isSelected(statusType) {
    return this.state.selectedStatusList.has(statusType);
  }

  handleClick(statusType) {
    const all = 'all';
    if (this.isSelected(statusType)) {
      this.deleteStatusFromList(statusType);
    } else {
      if (statusType === all) {
        this.clearStatusList();
      } else {
        this.deleteStatusFromList(all);
      }
      this.addStatusToList(statusType);
    }
  }

  async clearStatusList() {
    const { selectedStatusList } = this.state;
    selectedStatusList.clear();
    await this.setState({ selectedStatusList });
  }

  async addStatusToList(statusType) {
    const { selectedStatusList } = this.state;
    selectedStatusList.add(statusType);
    await this.setState({ selectedStatusList });
    this.retrieveUsersByPagingNum(1);
  }

  async deleteStatusFromList(statusType) {
    const { selectedStatusList } = this.state;
    selectedStatusList.delete(statusType);
    await this.setState({ selectedStatusList });
    this.retrieveUsersByPagingNum(1);
  }

  /**
   * Workaround for Increment Search Text Input
   */
  async handleChangeSearchText(searchText) {
    await this.setState({ searchText });
    this.handleChangeSearchTextDebouce();
  }

  async clearSearchText() {
    await this.setState({ searchText: '' });
    this.retrieveUsersByPagingNum(1);
  }

  /**
   * Workaround for Sorting
   */
  async sort(sort, isAsc) {
    const sortOrder = isAsc ? 'asc' : 'desc';
    await this.setState({ sort, sortOrder });
    this.retrieveUsersByPagingNum(1);
  }

  async resetAllChanges() {
    await this.setState({
      sort: 'id',
      sortOrder: 'asc',
      searchText: '',
      selectedStatusList: new Set(['all']),
    });
    this.retrieveUsersByPagingNum(1);
  }

  /**
   * syncUsers of selectedPage
   * @memberOf AdminUsersContainer
   * @param {number} selectedPage
   */
  async retrieveUsersByPagingNum(selectedPage) {
    const params = {
      page: selectedPage,
      sort: this.state.sort,
      sortOrder: this.state.sortOrder,
      selectedStatusList: Array.from(this.state.selectedStatusList),
      searchText: this.state.searchText,
      // Even if email is hidden, it will be displayed on admin page.
      forceIncludeAttributes: ['email'],
    };
    const { data } = await apiv3Get('/users', params);

    if (data.paginateResult == null) {
      throw new Error("data must conclude 'paginateResult' property.");
    }

    const {
      docs: users,
      totalDocs: totalUsers,
      limit: pagingLimit,
    } = data.paginateResult;

    this.setState({
      users,
      totalUsers,
      pagingLimit,
      activePage: selectedPage,
    });
  }

  /**
   * retrieve user statistics
   */
  async retrieveUserStatistics() {
    const statsRes = await apiv3Get('/statistics/user');
    const userStatistics = statsRes.data.data;
    this.setState({ userStatistics });
  }

  /**
   * create user invited
   * @memberOf AdminUsersContainer
   * @param {object} shapedEmailList
   * @param {bool} sendEmail
   */
  async createUserInvited(shapedEmailList, sendEmail) {
    const response = await apiv3Post('/users/invite', {
      shapedEmailList,
      sendEmail,
    });
    await this.retrieveUsersByPagingNum(this.state.activePage);
    return response.data;
  }

  /**
   * open reset password modal, and props user
   * @memberOf AdminUsersContainer
   * @param {object} user
   */
  async showPasswordResetModal(user) {
    await this.setState({
      isPasswordResetModalShown: true,
      userForPasswordResetModal: user,
    });
  }

  /**
   * close reset password modal
   * @memberOf AdminUsersContainer
   */
  async hidePasswordResetModal() {
    await this.setState({
      isPasswordResetModalShown: false,
      userForPasswordResetModal: null,
    });
  }

  /**
   * toggle user invite modal
   * @memberOf AdminUsersContainer
   */
  async toggleUserInviteModal() {
    await this.setState({
      isUserInviteModalShown: !this.state.isUserInviteModalShown,
    });
  }

  /**
   * Grant user admin
   * @memberOf AdminUsersContainer
   * @param {string} userId
   * @return {string} username
   */
  async grantUserAdmin(userId) {
    const response = await apiv3Put(`/users/${userId}/grant-admin`);
    const { username } = response.data.userData;
    await this.retrieveUsersByPagingNum(this.state.activePage);
    return username;
  }

  /**
   * Revoke user admin
   * @memberOf AdminUsersContainer
   * @param {string} userId
   * @return {string} username
   */
  async revokeUserAdmin(userId) {
    const response = await apiv3Put(`/users/${userId}/revoke-admin`);
    const { username } = response.data.userData;
    await this.retrieveUsersByPagingNum(this.state.activePage);
    return username;
  }

  /**
   * Grant user read only access
   * @memberOf AdminUsersContainer
   * @param {string} userId
   * @return {string} username
   */
  async grantUserReadOnly(userId) {
    const response = await apiv3Put(`/users/${userId}/grant-read-only`);
    const { username } = response.data.userData;
    await this.retrieveUsersByPagingNum(this.state.activePage);
    return username;
  }

  /**
   * Revoke user read only access
   * @memberOf AdminUsersContainer
   * @param {string} userId
   * @return {string} username
   */
  async revokeUserReadOnly(userId) {
    const response = await apiv3Put(`/users/${userId}/revoke-read-only`);
    const { username } = response.data.userData;
    await this.retrieveUsersByPagingNum(this.state.activePage);
    return username;
  }

  /**
   * Activate user
   * @memberOf AdminUsersContainer
   * @param {string} userId
   * @return {string} username
   */
  async activateUser(userId) {
    const response = await apiv3Put(`/users/${userId}/activate`);
    const { username } = response.data.userData;
    await this.retrieveUsersByPagingNum(this.state.activePage);
    return username;
  }

  /**
   * Deactivate user
   * @memberOf AdminUsersContainer
   * @param {string} userId
   * @return {string} username
   */
  async deactivateUser(userId) {
    const response = await apiv3Put(`/users/${userId}/deactivate`);
    const { username } = response.data.userData;
    await this.retrieveUsersByPagingNum(this.state.activePage);
    return username;
  }

  /**
   * remove user
   * @memberOf AdminUsersContainer
   * @param {string} userId
   * @return {object} removedUserData
   */
  async removeUser(userId) {
    const response = await apiv3Delete(`/users/${userId}/remove`);
    const removedUserData = response.data.userData;
    await this.retrieveUsersByPagingNum(this.state.activePage);
    return removedUserData;
  }
}
