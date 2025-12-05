import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import { apiv3Get, apiv3Post, apiv3Put } from '../util/apiv3-client';

/**
 * Service container for admin app setting page (AppSettings.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminAppContainer extends Container {

  constructor() {
    super();

    if (isServer()) {
      return;
    }

    this.state = {
      retrieveError: null,
      title: '',
      confidential: '',
      globalLang: '',
      isEmailPublishedForNewUser: true,
      fileUpload: '',

      isV5Compatible: null,
      siteUrl: '',
      siteUrlUseOnlyEnvVars: null,
      envSiteUrl: '',
      isSetSiteUrl: true,
      isMailerSetup: false,
      fromAddress: '',
      transmissionMethod: '',

      smtpHost: '',
      smtpPort: '',
      smtpUser: '',
      smtpPassword: '',
      sesAccessKeyId: '',
      sesSecretAccessKey: '',

      isMaintenanceMode: false,
    };

  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminAppContainer';
  }

  /**
   * retrieve app sttings data
   */
  async retrieveAppSettingsData() {
    const response = await apiv3Get('/app-settings/');
    const { appSettingsParams } = response.data;

    this.setState({
      title: appSettingsParams.title,
      confidential: appSettingsParams.confidential,
      globalLang: appSettingsParams.globalLang,
      isEmailPublishedForNewUser: appSettingsParams.isEmailPublishedForNewUser,
      fileUpload: appSettingsParams.fileUpload,
      isV5Compatible: appSettingsParams.isV5Compatible,
      siteUrl: appSettingsParams.siteUrl,
      siteUrlUseOnlyEnvVars: appSettingsParams.siteUrlUseOnlyEnvVars,
      envSiteUrl: appSettingsParams.envSiteUrl,
      isSetSiteUrl: !!appSettingsParams.siteUrl,
      isMailerSetup: appSettingsParams.isMailerSetup,
      fromAddress: appSettingsParams.fromAddress,
      transmissionMethod: appSettingsParams.transmissionMethod,
      smtpHost: appSettingsParams.smtpHost,
      smtpPort: appSettingsParams.smtpPort,
      smtpUser: appSettingsParams.smtpUser,
      smtpPassword: appSettingsParams.smtpPassword,
      sesAccessKeyId: appSettingsParams.sesAccessKeyId,
      sesSecretAccessKey: appSettingsParams.sesSecretAccessKey,

      isMaintenanceMode: appSettingsParams.isMaintenanceMode,
    });
  }

  /**
   * Change title
   */
  changeTitle(title) {
    this.setState({ title });
  }

  /**
   * Change confidential
   */
  changeConfidential(confidential) {
    this.setState({ confidential });
  }

  /**
   * Change globalLang
   */
  changeGlobalLang(globalLang) {
    this.setState({ globalLang });
  }

  /**
   * Change isEmailPublishedForNewUser
   */
  changeIsEmailPublishedForNewUserShow(isEmailPublishedForNewUser) {
    this.setState({ isEmailPublishedForNewUser });
  }

  /**
   * Change fileUpload
   */
  changeFileUpload(fileUpload) {
    this.setState({ fileUpload });
  }

  /**
   * Change site url
   */
  changeIsV5Compatible(isV5Compatible) {
    this.setState({ isV5Compatible });
  }

  /**
   * Change site url
   */
  changeSiteUrl(siteUrl) {
    this.setState({ siteUrl });
  }


  /**
   * Change from address
   */
  changeFromAddress(fromAddress) {
    this.setState({ fromAddress });
  }

  /**
   * Change from transmission method
   */
  changeTransmissionMethod(transmissionMethod) {
    this.setState({ transmissionMethod });
  }

  /**
   * Change smtp host
   */
  changeSmtpHost(smtpHost) {
    this.setState({ smtpHost });
  }

  /**
   * Change smtp port
   */
  changeSmtpPort(smtpPort) {
    this.setState({ smtpPort });
  }

  /**
   * Change smtp user
   */
  changeSmtpUser(smtpUser) {
    this.setState({ smtpUser });
  }

  /**
   * Change smtp password
   */
  changeSmtpPassword(smtpPassword) {
    this.setState({ smtpPassword });
  }

  /**
   * Change sesAccessKeyId
   */
  changeSesAccessKeyId(sesAccessKeyId) {
    this.setState({ sesAccessKeyId });
  }

  /**
   * Change sesSecretAccessKey
   */
  changeSesSecretAccessKey(sesSecretAccessKey) {
    this.setState({ sesSecretAccessKey });
  }

  /**
   * Update app setting
   * @memberOf AdminAppContainer
   * @return {Array} Appearance
   */
  async updateAppSettingHandler() {
    const response = await apiv3Put('/app-settings/app-setting', {
      title: this.state.title,
      confidential: this.state.confidential,
      globalLang: this.state.globalLang,
      isEmailPublishedForNewUser: this.state.isEmailPublishedForNewUser,
      fileUpload: this.state.fileUpload,
    });
    const { appSettingParams } = response.data;
    return appSettingParams;
  }


  /**
   * Update site url setting
   * @memberOf AdminAppContainer
   * @return {Array} Appearance
   */
  async updateSiteUrlSettingHandler() {
    const response = await apiv3Put('/app-settings/site-url-setting', {
      siteUrl: this.state.siteUrl,
    });
    const { siteUrlSettingParams } = response.data;
    return siteUrlSettingParams;
  }

  /**
   * Update mail setting
   * @memberOf AdminAppContainer
   * @return {Array} Appearance
   */
  updateMailSettingHandler() {
    if (this.state.transmissionMethod === 'smtp') {
      return this.updateSmtpSetting();
    }
    return this.updateSesSetting();
  }

  /**
   * Update smtp setting
   * @memberOf AdminAppContainer
   * @return {Array} Appearance
   */
  async updateSmtpSetting() {
    const response = await apiv3Put('/app-settings/smtp-setting', {
      fromAddress: this.state.fromAddress,
      transmissionMethod: this.state.transmissionMethod,
      smtpHost: this.state.smtpHost,
      smtpPort: this.state.smtpPort,
      smtpUser: this.state.smtpUser,
      smtpPassword: this.state.smtpPassword,
    });
    const { mailSettingParams } = response.data;
    this.setState({ isMailerSetup: mailSettingParams.isMailerSetup });
    return mailSettingParams;
  }

  /**
   * Update ses setting
   * @memberOf AdminAppContainer
   * @return {Array} Appearance
   */
  async updateSesSetting() {
    const response = await apiv3Put('/app-settings/ses-setting', {
      fromAddress: this.state.fromAddress,
      transmissionMethod: this.state.transmissionMethod,
      sesAccessKeyId: this.state.sesAccessKeyId,
      sesSecretAccessKey: this.state.sesSecretAccessKey,
    });
    const { mailSettingParams } = response.data;
    this.setState({ isMailerSetup: mailSettingParams.isMailerSetup });
    return mailSettingParams;
  }

  /**
   * send test e-mail
   * @memberOf AdminAppContainer
   */
  async sendTestEmail() {
    return apiv3Post('/app-settings/smtp-test');
  }

  /**
   * Start v5 page migration
   * @memberOf AdminAppContainer
   */
  async v5PageMigrationHandler() {
    const response = await apiv3Post('/app-settings/v5-schema-migration');
    const { isV5Compatible } = response.data;
    return { isV5Compatible };
  }

  async startMaintenanceMode() {
    await apiv3Post('/app-settings/maintenance-mode', { flag: true });
  }

  async endMaintenanceMode() {
    await apiv3Post('/app-settings/maintenance-mode', { flag: false });
  }

}
