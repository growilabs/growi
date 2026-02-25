import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import loggerFactory from '~/utils/logger';
import { removeNullPropertyFromObject } from '~/utils/object-utils';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

const logger = loggerFactory('growi:security:AdminGoogleSecurityContainer');

/**
 * Service container for admin security page (GoogleSecurityManagement.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminGoogleSecurityContainer extends Container {
  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.dummyGoogleClientId = 0;
    this.dummyGoogleClientIdForError = 1;

    this.state = {
      retrieveError: null,
      // set dummy value tile for using suspense
      googleClientId: this.dummyGoogleClientId,
      googleClientSecret: '',
      isSameEmailTreatedAsIdenticalUser: false,
    };
  }

  /**
   * retrieve security data
   */
  async retrieveSecurityData() {
    try {
      const response = await apiv3Get('/security-setting/');
      const { googleOAuth } = response.data.securityParams;
      this.setState({
        googleClientId: googleOAuth.googleClientId,
        googleClientSecret: googleOAuth.googleClientSecret,
        isSameEmailTreatedAsIdenticalUser:
          googleOAuth.isSameEmailTreatedAsIdenticalUser,
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
    return 'AdminGoogleSecurityContainer';
  }

  /**
   * Switch isSameEmailTreatedAsIdenticalUser
   */
  switchIsSameEmailTreatedAsIdenticalUser() {
    this.setState({
      isSameEmailTreatedAsIdenticalUser:
        !this.state.isSameEmailTreatedAsIdenticalUser,
    });
  }

  /**
   * Update googleSetting
   */
  async updateGoogleSetting(formData) {
    let requestParams =
      formData != null
        ? {
            googleClientId: formData.googleClientId,
            googleClientSecret: formData.googleClientSecret,
            isSameEmailTreatedAsIdenticalUser:
              formData.isSameEmailTreatedAsIdenticalUser,
          }
        : {
            googleClientId: this.state.googleClientId,
            googleClientSecret: this.state.googleClientSecret,
            isSameEmailTreatedAsIdenticalUser:
              this.state.isSameEmailTreatedAsIdenticalUser,
          };

    requestParams = await removeNullPropertyFromObject(requestParams);
    const response = await apiv3Put(
      '/security-setting/google-oauth',
      requestParams,
    );
    const { securitySettingParams } = response.data;

    this.setState({
      googleClientId: securitySettingParams.googleClientId,
      googleClientSecret: securitySettingParams.googleClientSecret,
      isSameEmailTreatedAsIdenticalUser:
        securitySettingParams.isSameEmailTreatedAsIdenticalUser,
    });
    return response;
  }
}
