import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import loggerFactory from '~/utils/logger';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:services:AdminLocalSecurityContainer');
/**
 * Service container for admin security page (LocalSecuritySetting.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminLocalSecurityContainer extends Container {

  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;
    this.dummyRegistrationMode = 0;
    this.dummyRegistrationModeForError = 1;

    this.state = {
      retrieveError: null,
      // set dummy value tile for using suspense
      registrationMode: this.dummyRegistrationMode,
      registrationWhitelist: [],
      useOnlyEnvVars: false,
      isPasswordResetEnabled: false,
      isEmailAuthenticationEnabled: false,
    };

  }

  async retrieveSecurityData() {
    try {
      const response = await apiv3Get('/security-setting/');
      const { localSetting } = response.data.securityParams;
      this.setState({
        useOnlyEnvVars: localSetting.useOnlyEnvVarsForSomeOptions,
        registrationMode: localSetting.registrationMode,
        registrationWhitelist: localSetting.registrationWhitelist,
        isPasswordResetEnabled: localSetting.isPasswordResetEnabled,
        isEmailAuthenticationEnabled: localSetting.isEmailAuthenticationEnabled,
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
    return 'AdminLocalSecurityContainer';
  }


  /**
   * Change registration mode
   */
  changeRegistrationMode(value) {
    this.setState({ registrationMode: value });
  }

  /**
   * Switch password reset enabled
   */
  switchIsPasswordResetEnabled() {
    this.setState({ isPasswordResetEnabled: !this.state.isPasswordResetEnabled });
  }

  /**
   * Switch email authentication enabled
   */
  switchIsEmailAuthenticationEnabled() {
    this.setState({ isEmailAuthenticationEnabled: !this.state.isEmailAuthenticationEnabled });
  }

  /**
   * update local security setting
   */
  async updateLocalSecuritySetting(formData) {
    const requestParams = formData != null ? {
      registrationMode: formData.registrationMode,
      registrationWhitelist: formData.registrationWhitelist,
      isPasswordResetEnabled: formData.isPasswordResetEnabled,
      isEmailAuthenticationEnabled: formData.isEmailAuthenticationEnabled,
    } : {
      registrationMode: this.state.registrationMode,
      registrationWhitelist: this.state.registrationWhitelist,
      isPasswordResetEnabled: this.state.isPasswordResetEnabled,
      isEmailAuthenticationEnabled: this.state.isEmailAuthenticationEnabled,
    };
    const response = await apiv3Put('/security-setting/local-setting', requestParams);

    const { localSettingParams } = response.data;

    this.setState({
      registrationMode: localSettingParams.registrationMode,
      registrationWhitelist: localSettingParams.registrationWhitelist,
      isPasswordResetEnabled: localSettingParams.isPasswordResetEnabled,
      isEmailAuthenticationEnabled: localSettingParams.isEmailAuthenticationEnabled,
    });

    return localSettingParams;
  }


}
