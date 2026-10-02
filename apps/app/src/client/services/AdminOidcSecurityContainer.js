import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import loggerFactory from '~/utils/logger';
import { removeNullPropertyFromObject } from '~/utils/object-utils';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

const logger = loggerFactory('growi:services:AdminLdapSecurityContainer');

/**
 * Service container for admin security page (OidcSecurityManagement.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminOidcSecurityContainer extends Container {
  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;

    this.state = {
      retrieveError: null,
      oidcProviderName: '',
      oidcIssuerHost: '',
      oidcAuthorizationEndpoint: '',
      oidcTokenEndpoint: '',
      oidcRevocationEndpoint: '',
      oidcIntrospectionEndpoint: '',
      oidcUserInfoEndpoint: '',
      oidcEndSessionEndpoint: '',
      oidcRegistrationEndpoint: '',
      oidcJWKSUri: '',
      oidcClientId: '',
      oidcClientSecret: '',
      oidcAttrMapId: '',
      oidcAttrMapUserName: '',
      oidcAttrMapName: '',
      oidcAttrMapEmail: '',
      isSameUsernameTreatedAsIdenticalUser: false,
      isSameEmailTreatedAsIdenticalUser: false,
    };
  }

  /**
   * retrieve security data
   */
  async retrieveSecurityData() {
    try {
      const response = await apiv3Get('/security-setting/');
      const { oidcAuth } = response.data.securityParams;
      this.setState({
        oidcProviderName: oidcAuth.oidcProviderName,
        oidcIssuerHost: oidcAuth.oidcIssuerHost,
        oidcAuthorizationEndpoint: oidcAuth.oidcAuthorizationEndpoint,
        oidcTokenEndpoint: oidcAuth.oidcTokenEndpoint,
        oidcRevocationEndpoint: oidcAuth.oidcRevocationEndpoint,
        oidcIntrospectionEndpoint: oidcAuth.oidcIntrospectionEndpoint,
        oidcUserInfoEndpoint: oidcAuth.oidcUserInfoEndpoint,
        oidcEndSessionEndpoint: oidcAuth.oidcEndSessionEndpoint,
        oidcRegistrationEndpoint: oidcAuth.oidcRegistrationEndpoint,
        oidcJWKSUri: oidcAuth.oidcJWKSUri,
        oidcClientId: oidcAuth.oidcClientId,
        oidcClientSecret: oidcAuth.oidcClientSecret,
        oidcAttrMapId: oidcAuth.oidcAttrMapId,
        oidcAttrMapUserName: oidcAuth.oidcAttrMapUserName,
        oidcAttrMapName: oidcAuth.oidcAttrMapName,
        oidcAttrMapEmail: oidcAuth.oidcAttrMapEmail,
        isSameUsernameTreatedAsIdenticalUser:
          oidcAuth.isSameUsernameTreatedAsIdenticalUser,
        isSameEmailTreatedAsIdenticalUser:
          oidcAuth.isSameEmailTreatedAsIdenticalUser,
      });
    } catch (err) {
      this.setState({ retrieveError: err });
      logger.error(err);
      throw new Error('Failed to fetch data');
    }
  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminOidcSecurityContainer';
  }

  /**
   * Switch sameUsernameTreatedAsIdenticalUser
   */
  switchIsSameUsernameTreatedAsIdenticalUser() {
    this.setState({
      isSameUsernameTreatedAsIdenticalUser:
        !this.state.isSameUsernameTreatedAsIdenticalUser,
    });
  }

  /**
   * Switch sameEmailTreatedAsIdenticalUser
   */
  switchIsSameEmailTreatedAsIdenticalUser() {
    this.setState({
      isSameEmailTreatedAsIdenticalUser:
        !this.state.isSameEmailTreatedAsIdenticalUser,
    });
  }

  /**
   * Update OpenID Connect
   */
  async updateOidcSetting(formData) {
    let requestParams =
      formData != null
        ? {
            oidcProviderName: formData.oidcProviderName,
            oidcIssuerHost: formData.oidcIssuerHost,
            oidcAuthorizationEndpoint: formData.oidcAuthorizationEndpoint,
            oidcTokenEndpoint: formData.oidcTokenEndpoint,
            oidcRevocationEndpoint: formData.oidcRevocationEndpoint,
            oidcIntrospectionEndpoint: formData.oidcIntrospectionEndpoint,
            oidcUserInfoEndpoint: formData.oidcUserInfoEndpoint,
            oidcEndSessionEndpoint: formData.oidcEndSessionEndpoint,
            oidcRegistrationEndpoint: formData.oidcRegistrationEndpoint,
            oidcJWKSUri: formData.oidcJWKSUri,
            oidcClientId: formData.oidcClientId,
            oidcClientSecret: formData.oidcClientSecret,
            oidcAttrMapId: formData.oidcAttrMapId,
            oidcAttrMapUserName: formData.oidcAttrMapUserName,
            oidcAttrMapName: formData.oidcAttrMapName,
            oidcAttrMapEmail: formData.oidcAttrMapEmail,
            isSameUsernameTreatedAsIdenticalUser:
              formData.isSameUsernameTreatedAsIdenticalUser,
            isSameEmailTreatedAsIdenticalUser:
              formData.isSameEmailTreatedAsIdenticalUser,
          }
        : {
            oidcProviderName: this.state.oidcProviderName,
            oidcIssuerHost: this.state.oidcIssuerHost,
            oidcAuthorizationEndpoint: this.state.oidcAuthorizationEndpoint,
            oidcTokenEndpoint: this.state.oidcTokenEndpoint,
            oidcRevocationEndpoint: this.state.oidcRevocationEndpoint,
            oidcIntrospectionEndpoint: this.state.oidcIntrospectionEndpoint,
            oidcUserInfoEndpoint: this.state.oidcUserInfoEndpoint,
            oidcEndSessionEndpoint: this.state.oidcEndSessionEndpoint,
            oidcRegistrationEndpoint: this.state.oidcRegistrationEndpoint,
            oidcJWKSUri: this.state.oidcJWKSUri,
            oidcClientId: this.state.oidcClientId,
            oidcClientSecret: this.state.oidcClientSecret,
            oidcAttrMapId: this.state.oidcAttrMapId,
            oidcAttrMapUserName: this.state.oidcAttrMapUserName,
            oidcAttrMapName: this.state.oidcAttrMapName,
            oidcAttrMapEmail: this.state.oidcAttrMapEmail,
            isSameUsernameTreatedAsIdenticalUser:
              this.state.isSameUsernameTreatedAsIdenticalUser,
            isSameEmailTreatedAsIdenticalUser:
              this.state.isSameEmailTreatedAsIdenticalUser,
          };

    requestParams = await removeNullPropertyFromObject(requestParams);
    const response = await apiv3Put('/security-setting/oidc', requestParams);
    const { securitySettingParams } = response.data;

    this.setState({
      oidcProviderName: securitySettingParams.oidcProviderName,
      oidcIssuerHost: securitySettingParams.oidcIssuerHost,
      oidcAuthorizationEndpoint:
        securitySettingParams.oidcAuthorizationEndpoint,
      oidcTokenEndpoint: securitySettingParams.oidcTokenEndpoint,
      oidcRevocationEndpoint: securitySettingParams.oidcRevocationEndpoint,
      oidcIntrospectionEndpoint:
        securitySettingParams.oidcIntrospectionEndpoint,
      oidcUserInfoEndpoint: securitySettingParams.oidcUserInfoEndpoint,
      oidcEndSessionEndpoint: securitySettingParams.oidcEndSessionEndpoint,
      oidcRegistrationEndpoint: securitySettingParams.oidcRegistrationEndpoint,
      oidcJWKSUri: securitySettingParams.oidcJWKSUri,
      oidcClientId: securitySettingParams.oidcClientId,
      oidcClientSecret: securitySettingParams.oidcClientSecret,
      oidcAttrMapId: securitySettingParams.oidcAttrMapId,
      oidcAttrMapUserName: securitySettingParams.oidcAttrMapUserName,
      oidcAttrMapName: securitySettingParams.oidcAttrMapName,
      oidcAttrMapEmail: securitySettingParams.oidcAttrMapEmail,
      isSameUsernameTreatedAsIdenticalUser:
        securitySettingParams.isSameUsernameTreatedAsIdenticalUser,
      isSameEmailTreatedAsIdenticalUser:
        securitySettingParams.isSameEmailTreatedAsIdenticalUser,
    });
    return response;
  }
}
