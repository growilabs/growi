import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import {
  PageSingleDeleteConfigValue, PageSingleDeleteCompConfigValue,
  PageRecursiveDeleteConfigValue, PageRecursiveDeleteCompConfigValue,
} from '~/interfaces/page-delete-config';
import { removeNullPropertyFromObject } from '~/utils/object-utils';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';
import { toastError } from '../util/toastr';

/**
 * Service container for admin security page (SecuritySetting.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminGeneralSecurityContainer extends Container {

  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.state = {
      retrieveError: null,
      sessionMaxAge: null,
      wikiMode: '',
      currentRestrictGuestMode: '',
      currentPageDeletionAuthority: PageSingleDeleteConfigValue.AdminOnly,
      currentPageRecursiveDeletionAuthority: PageRecursiveDeleteConfigValue.Inherit,
      currentPageCompleteDeletionAuthority: PageSingleDeleteCompConfigValue.AdminOnly,
      currentPageRecursiveCompleteDeletionAuthority: PageRecursiveDeleteCompConfigValue.Inherit,
      currentGroupRestrictionDisplayMode: 'Hidden',
      currentOwnerRestrictionDisplayMode: 'Hidden',
      isAllGroupMembershipRequiredForPageCompleteDeletion: true,
      previousPageRecursiveDeletionAuthority: null,
      previousPageRecursiveCompleteDeletionAuthority: null,
      expandOtherOptionsForDeletion: false,
      expandOtherOptionsForCompleteDeletion: false,
      isShowRestrictedByOwner: false,
      isUsersHomepageDeletionEnabled: false,
      isForceDeleteUserHomepageOnUserDeletion: false,
      isRomUserAllowedToComment: false,
      isLocalEnabled: false,
      isLdapEnabled: false,
      isSamlEnabled: false,
      isOidcEnabled: false,
      isGoogleEnabled: false,
      isGitHubEnabled: false,
      setupStrategies: [],
      disableLinkSharing: false,
      shareLinks: [],
      totalshareLinks: 0,
      shareLinksPagingLimit: Infinity,
      shareLinksActivePage: 1,
    };

    this.changeOwnerRestrictionDisplayMode = this.changeOwnerRestrictionDisplayMode.bind(this);
    this.changeGroupRestrictionDisplayMode = this.changeGroupRestrictionDisplayMode.bind(this);
    this.changePageDeletionAuthority = this.changePageDeletionAuthority.bind(this);
    this.changePageCompleteDeletionAuthority = this.changePageCompleteDeletionAuthority.bind(this);
    this.changePageRecursiveDeletionAuthority = this.changePageRecursiveDeletionAuthority.bind(this);
    this.changePageRecursiveCompleteDeletionAuthority = this.changePageRecursiveCompleteDeletionAuthority.bind(this);
    this.changePreviousPageRecursiveDeletionAuthority = this.changePreviousPageRecursiveDeletionAuthority.bind(this);
    this.changePreviousPageRecursiveCompleteDeletionAuthority = this.changePreviousPageRecursiveCompleteDeletionAuthority.bind(this);

  }

  async retrieveSecurityData() {
    await this.retrieveSetupStratedies();
    const response = await apiv3Get('/security-setting/');
    const { generalSetting, shareLinkSetting, generalAuth } = response.data.securityParams;
    this.setState({
      currentRestrictGuestMode: generalSetting.restrictGuestMode,
      currentPageDeletionAuthority: generalSetting.pageDeletionAuthority,
      currentPageCompleteDeletionAuthority: generalSetting.pageCompleteDeletionAuthority,
      currentPageRecursiveDeletionAuthority: generalSetting.pageRecursiveDeletionAuthority,
      currentPageRecursiveCompleteDeletionAuthority: generalSetting.pageRecursiveCompleteDeletionAuthority,
      isAllGroupMembershipRequiredForPageCompleteDeletion: generalSetting.isAllGroupMembershipRequiredForPageCompleteDeletion,
      // Set display to 'Hidden' if hideRestrictedByOwner is anything but false.
      currentOwnerRestrictionDisplayMode: generalSetting.hideRestrictedByOwner === false ? 'Displayed' : 'Hidden',
      currentGroupRestrictionDisplayMode: generalSetting.hideRestrictedByGroup === false ? 'Displayed' : 'Hidden',
      isUsersHomepageDeletionEnabled: generalSetting.isUsersHomepageDeletionEnabled,
      isForceDeleteUserHomepageOnUserDeletion: generalSetting.isForceDeleteUserHomepageOnUserDeletion,
      isRomUserAllowedToComment: generalSetting.isRomUserAllowedToComment,
      sessionMaxAge: generalSetting.sessionMaxAge,
      wikiMode: generalSetting.wikiMode,
      disableLinkSharing: shareLinkSetting.disableLinkSharing,
      isLocalEnabled: generalAuth.isLocalEnabled,
      isLdapEnabled: generalAuth.isLdapEnabled,
      isSamlEnabled: generalAuth.isSamlEnabled,
      isOidcEnabled: generalAuth.isOidcEnabled,
      isGoogleEnabled: generalAuth.isGoogleEnabled,
      isGitHubEnabled: generalAuth.isGitHubEnabled,
    });
  }


  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminGeneralSecurityContainer';
  }

  /**
   * get isWikiModeForced
   * @return {bool} isWikiModeForced
   */
  get isWikiModeForced() {
    return this.state.wikiMode === 'public' || this.state.wikiMode === 'private';
  }

  /**
   * setter for sessionMaxAge
   */
  setSessionMaxAge(sessionMaxAge) {
    this.setState({ sessionMaxAge });
  }

  /**
   * setter for disableLinkSharing
   */
  setDisableLinkSharing(disableLinkSharing) {
    this.setState({ disableLinkSharing });
  }

  /**
   * Change ownerRestrictionDisplayMode
   */
  changeOwnerRestrictionDisplayMode(mode) {
    this.setState({ currentOwnerRestrictionDisplayMode: mode });
  }

  /**
   * Change groupRestrictionDisplayMode
   */
  changeGroupRestrictionDisplayMode(mode) {
    this.setState({ currentGroupRestrictionDisplayMode: mode });
  }

  /**
   * Change restrictGuestMode
   */
  changeRestrictGuestMode(restrictGuestModeLabel) {
    this.setState({ currentRestrictGuestMode: restrictGuestModeLabel });
  }

  /**
   * Change pageDeletionAuthority
   */
  changePageDeletionAuthority(val) {
    this.setState({ currentPageDeletionAuthority: val });
  }

  /**
   * Change pageCompleteDeletionAuthority
   */
  changePageCompleteDeletionAuthority(val) {
    this.setState({ currentPageCompleteDeletionAuthority: val });
  }

  /**
   * Change pageRecursiveDeletionAuthority
   */
  changePageRecursiveDeletionAuthority(val) {
    this.setState({ currentPageRecursiveDeletionAuthority: val });
  }

  /**
   * Change pageRecursiveCompleteDeletionAuthority
   */
  changePageRecursiveCompleteDeletionAuthority(val) {
    this.setState({ currentPageRecursiveCompleteDeletionAuthority: val });
  }

  /**
   * Switch isAllGroupMembershipRequiredForPageCompleteDeletion
   */
  switchIsAllGroupMembershipRequiredForPageCompleteDeletion() {
    this.setState({ isAllGroupMembershipRequiredForPageCompleteDeletion: !this.state.isAllGroupMembershipRequiredForPageCompleteDeletion });
  }

  /**
   * Change previousPageRecursiveDeletionAuthority
   */
  changePreviousPageRecursiveDeletionAuthority(val) {
    this.setState({ previousPageRecursiveDeletionAuthority: val });
  }


  /**
   * Change previousPageRecursiveCompleteDeletionAuthority
   */
  changePreviousPageRecursiveCompleteDeletionAuthority(val) {
    this.setState({ previousPageRecursiveCompleteDeletionAuthority: val });
  }

  /**
   * Switch ExpandOtherOptionsForDeletion
   */
  switchExpandOtherOptionsForDeletion(bool) {
    this.setState({ expandOtherOptionsForDeletion: bool });
  }

  /**
   * Switch ExpandOtherOptionsForDeletion
   */
  switchExpandOtherOptionsForCompleteDeletion(bool) {
    this.setState({ expandOtherOptionsForCompleteDeletion: bool });
  }

  /**
   * Switch isUsersHomepageDeletionEnabled
   */
  switchIsUsersHomepageDeletionEnabled() {
    this.setState({ isUsersHomepageDeletionEnabled: !this.state.isUsersHomepageDeletionEnabled });
  }

  /**
   * Switch isForceDeleteUserHomepageOnUserDeletion
   */
  switchIsForceDeleteUserHomepageOnUserDeletion() {
    this.setState({ isForceDeleteUserHomepageOnUserDeletion: !this.state.isForceDeleteUserHomepageOnUserDeletion });
  }

  /**
   * switch isRomUserAllowedToComment
   */
  switchIsRomUserAllowedToComment(bool) {
    this.setState({ isRomUserAllowedToComment: bool });
  }


  /**
   * Update restrictGuestMode
   * @memberOf AdminGeneralSecuritySContainer
   * @return {string} Appearance
   */
  async updateGeneralSecuritySetting(formData) {

    let requestParams = formData != null ? {
      sessionMaxAge: formData.sessionMaxAge,
      restrictGuestMode: formData.restrictGuestMode,
      pageDeletionAuthority: formData.pageDeletionAuthority,
      pageCompleteDeletionAuthority: formData.pageCompleteDeletionAuthority,
      pageRecursiveDeletionAuthority: formData.pageRecursiveDeletionAuthority,
      pageRecursiveCompleteDeletionAuthority: formData.pageRecursiveCompleteDeletionAuthority,
      isAllGroupMembershipRequiredForPageCompleteDeletion: formData.isAllGroupMembershipRequiredForPageCompleteDeletion,
      hideRestrictedByGroup: formData.hideRestrictedByGroup,
      hideRestrictedByOwner: formData.hideRestrictedByOwner,
      isUsersHomepageDeletionEnabled: formData.isUsersHomepageDeletionEnabled,
      isForceDeleteUserHomepageOnUserDeletion: formData.isForceDeleteUserHomepageOnUserDeletion,
      isRomUserAllowedToComment: formData.isRomUserAllowedToComment,
    } : {
      sessionMaxAge: this.state.sessionMaxAge,
      restrictGuestMode: this.state.currentRestrictGuestMode,
      pageDeletionAuthority: this.state.currentPageDeletionAuthority,
      pageCompleteDeletionAuthority: this.state.currentPageCompleteDeletionAuthority,
      pageRecursiveDeletionAuthority: this.state.currentPageRecursiveDeletionAuthority,
      pageRecursiveCompleteDeletionAuthority: this.state.currentPageRecursiveCompleteDeletionAuthority,
      isAllGroupMembershipRequiredForPageCompleteDeletion: this.state.isAllGroupMembershipRequiredForPageCompleteDeletion,
      hideRestrictedByGroup: this.state.currentGroupRestrictionDisplayMode === 'Hidden',
      hideRestrictedByOwner: this.state.currentOwnerRestrictionDisplayMode === 'Hidden',
      isUsersHomepageDeletionEnabled: this.state.isUsersHomepageDeletionEnabled,
      isForceDeleteUserHomepageOnUserDeletion: this.state.isForceDeleteUserHomepageOnUserDeletion,
      isRomUserAllowedToComment: this.state.isRomUserAllowedToComment,
    };

    requestParams = await removeNullPropertyFromObject(requestParams);
    const response = await apiv3Put('/security-setting/general-setting', requestParams);
    const { securitySettingParams } = response.data;
    return securitySettingParams;
  }

  /**
   * Switch disableLinkSharing
   */
  async switchDisableLinkSharing() {
    const requestParams = {
      disableLinkSharing: !this.state.disableLinkSharing,
    };
    const response = await apiv3Put('/security-setting/share-link-setting', requestParams);
    this.setDisableLinkSharing(!this.state.disableLinkSharing);
    return response;
  }

  /**
   * Switch authentication
   */
  async switchAuthentication(stateVariableName, authId) {
    const isEnabled = !this.state[stateVariableName];
    try {
      await apiv3Put('/security-setting/authentication/enabled', {
        isEnabled,
        authId,
      });
      await this.retrieveSetupStratedies();
      this.setState({ [stateVariableName]: isEnabled });
    }
    catch (err) {
      toastError(err);
    }
  }

  /**
   * Retrieve SetupStratedies
   */
  async retrieveSetupStratedies() {
    try {
      const response = await apiv3Get('/security-setting/authentication');
      const { setupStrategies } = response.data;
      this.setState({ setupStrategies });
    }
    catch (err) {
      toastError(err);
    }
  }

  /**
   * Retrieve All Sharelinks
   */
  async retrieveShareLinksByPagingNum(page) {

    const params = {
      page,
    };

    const { data } = await apiv3Get('/security-setting/all-share-links', params);

    if (data.paginateResult == null) {
      throw new Error('data must conclude \'paginateResult\' property.');
    }

    const { docs: shareLinks, totalDocs: totalshareLinks, limit: shareLinksPagingLimit } = data.paginateResult;

    this.setState({
      shareLinks,
      totalshareLinks,
      shareLinksPagingLimit,
      shareLinksActivePage: page,
    });
  }

  /**
   * Switch local enabled
   */
  async switchIsLocalEnabled() {
    this.switchAuthentication('isLocalEnabled', 'local');
  }

  /**
   * Switch LDAP enabled
   */
  async switchIsLdapEnabled() {
    this.switchAuthentication('isLdapEnabled', 'ldap');
  }

  /**
   * Switch SAML enabled
   */
  async switchIsSamlEnabled() {
    this.switchAuthentication('isSamlEnabled', 'saml');
  }

  /**
   * Switch Oidc enabled
   */
  async switchIsOidcEnabled() {
    this.switchAuthentication('isOidcEnabled', 'oidc');
  }

  /**
   * Switch GoogleOAuth enabled
   */
  async switchIsGoogleOAuthEnabled() {
    this.switchAuthentication('isGoogleEnabled', 'google');
  }

  /**
   * Switch GitHubOAuth enabled
   */
  async switchIsGitHubOAuthEnabled() {
    this.switchAuthentication('isGitHubEnabled', 'github');
  }

}
