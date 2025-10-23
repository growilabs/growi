import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import loggerFactory from '~/utils/logger';
import { removeNullPropertyFromObject } from '~/utils/object-utils';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

const logger = loggerFactory('growi:services:AdminLdapSecurityContainer');

/**
 * Service container for admin security page (SecurityLdapSetting.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminLdapSecurityContainer extends Container {

  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;

    this.state = {
      retrieveError: null,
      serverUrl: '',
      isUserBind: false,
      ldapBindDN: '',
      ldapBindDNPassword: '',
      ldapSearchFilter: '',
      ldapAttrMapUsername: '',
      isSameUsernameTreatedAsIdenticalUser: false,
      ldapAttrMapMail: '',
      ldapAttrMapName: '',
      ldapGroupSearchBase: '',
      ldapGroupSearchFilter: '',
      ldapGroupDnProperty: '',
    };

  }

  /**
   * retrieve security data
   */
  async retrieveSecurityData() {
    try {
      const response = await apiv3Get('/security-setting/');
      const { ldapAuth } = response.data.securityParams;
      this.setState({
        serverUrl: ldapAuth.serverUrl,
        isUserBind: ldapAuth.isUserBind,
        ldapBindDN: ldapAuth.ldapBindDN,
        ldapBindDNPassword: ldapAuth.ldapBindDNPassword,
        ldapSearchFilter: ldapAuth.ldapSearchFilter,
        ldapAttrMapUsername: ldapAuth.ldapAttrMapUsername,
        isSameUsernameTreatedAsIdenticalUser: ldapAuth.isSameUsernameTreatedAsIdenticalUser,
        ldapAttrMapMail: ldapAuth.ldapAttrMapMail,
        ldapAttrMapName: ldapAuth.ldapAttrMapName,
        ldapGroupSearchBase: ldapAuth.ldapGroupSearchBase,
        ldapGroupSearchFilter: ldapAuth.ldapGroupSearchFilter,
        ldapGroupDnProperty: ldapAuth.ldapGroupDnProperty,
      });
    }
    catch (err) {
      this.setState({ retrieveError: err });
      logger.error(err);
      throw new Error('Failed to fetch data');
    }
  }


  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminLdapSecurityContainer';
  }

  /**
   * Change serverUrl
   */
  changeServerUrl(serverUrl) {
    this.setState({ serverUrl });
  }

  /**
   * Change ldapBindMode
   * @param {boolean} isUserBind true: User Bind, false: Admin Bind
   */
  changeLdapBindMode(isUserBind) {
    this.setState({ isUserBind });
  }

  /**
   * Change bindDN
   */
  changeBindDN(ldapBindDN) {
    this.setState({ ldapBindDN });
  }

  /**
   * Change bindDNPassword
   */
  changeBindDNPassword(ldapBindDNPassword) {
    this.setState({ ldapBindDNPassword });
  }

  /**
   * Change ldapSearchFilter
   */
  changeSearchFilter(ldapSearchFilter) {
    this.setState({ ldapSearchFilter });
  }

  /**
   * Change ldapAttrMapUsername
   */
  changeAttrMapUsername(ldapAttrMapUsername) {
    this.setState({ ldapAttrMapUsername });
  }

  /**
   * Switch is same username treated as identical user
   */
  switchIsSameUsernameTreatedAsIdenticalUser() {
    this.setState({ isSameUsernameTreatedAsIdenticalUser: !this.state.isSameUsernameTreatedAsIdenticalUser });
  }

  /**
   * Change ldapAttrMapMail
   */
  changeAttrMapMail(ldapAttrMapMail) {
    this.setState({ ldapAttrMapMail });
  }

  /**
   * Change ldapAttrMapName
   */
  changeAttrMapName(ldapAttrMapName) {
    this.setState({ ldapAttrMapName });
  }

  /**
   * Change ldapGroupSearchBase
   */
  changeGroupSearchBase(ldapGroupSearchBase) {
    this.setState({ ldapGroupSearchBase });
  }

  /**
   * Change ldapGroupSearchFilter
   */
  changeGroupSearchFilter(ldapGroupSearchFilter) {
    this.setState({ ldapGroupSearchFilter });
  }

  /**
   * Change ldapGroupDnProperty
   */
  changeGroupDnProperty(ldapGroupDnProperty) {
    this.setState({ ldapGroupDnProperty });
  }

  /**
   * Update ldap option
   */
  async updateLdapSetting() {
    const {
      serverUrl, isUserBind, ldapBindDN, ldapBindDNPassword, ldapSearchFilter, ldapAttrMapUsername, isSameUsernameTreatedAsIdenticalUser,
      ldapAttrMapMail, ldapAttrMapName, ldapGroupSearchBase, ldapGroupSearchFilter, ldapGroupDnProperty,
    } = this.state;

    let requestParams = {
      serverUrl,
      isUserBind,
      ldapBindDN,
      ldapBindDNPassword,
      ldapSearchFilter,
      ldapAttrMapUsername,
      isSameUsernameTreatedAsIdenticalUser,
      ldapAttrMapMail,
      ldapAttrMapName,
      ldapGroupSearchBase,
      ldapGroupSearchFilter,
      ldapGroupDnProperty,
    };

    requestParams = await removeNullPropertyFromObject(requestParams);
    const response = await apiv3Put('/security-setting/ldap', requestParams);
    const { securitySettingParams } = response.data;

    this.setState({
      serverUrl: securitySettingParams.serverUrl,
      isUserBind: securitySettingParams.isUserBind,
      ldapBindDN: securitySettingParams.ldapBindDN,
      ldapBindDNPassword: securitySettingParams.ldapBindDNPassword,
      ldapSearchFilter: securitySettingParams.ldapSearchFilter,
      ldapAttrMapUsername: securitySettingParams.ldapAttrMapUsername,
      isSameUsernameTreatedAsIdenticalUser: securitySettingParams.isSameUsernameTreatedAsIdenticalUser,
      ldapAttrMapMail: securitySettingParams.ldapAttrMapMail,
      ldapAttrMapName: securitySettingParams.ldapAttrMapName,
      ldapGroupSearchBase: securitySettingParams.ldapGroupSearchBase,
      ldapGroupSearchFilter: securitySettingParams.ldapGroupSearchFilter,
      ldapGroupDnProperty: securitySettingParams.ldapGroupDnProperty,
    });
    return response;
  }

}
