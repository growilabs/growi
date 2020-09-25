import { Container } from 'unstated';

/**
 * Service container for admin app setting page (AppSettings.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminAppContainer extends Container {

  constructor(appContainer) {
    super();

    this.appContainer = appContainer;
    this.dummyTitle = 0;
    this.dummyTitleForError = 1;

    this.state = {
      retrieveError: null,
      // set dummy value tile for using suspense
      title: this.dummyTitle,
      confidential: '',
      globalLang: '',
      fileUpload: '',
      siteUrl: '',
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
      region: '',
      customEndpoint: '',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      isEnabledPlugins: true,
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
    const response = await this.appContainer.apiv3.get('/app-settings/');
    const { appSettingsParams } = response.data;

    this.setState({
      title: appSettingsParams.title,
      confidential: appSettingsParams.confidential,
      globalLang: appSettingsParams.globalLang,
      fileUpload: appSettingsParams.fileUpload,
      siteUrl: appSettingsParams.siteUrl,
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
      region: appSettingsParams.region,
      customEndpoint: appSettingsParams.customEndpoint,
      bucket: appSettingsParams.bucket,
      accessKeyId: appSettingsParams.accessKeyId,
      secretAccessKey: appSettingsParams.secretAccessKey,
      isEnabledPlugins: appSettingsParams.isEnabledPlugins,
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
   * Change fileUpload
   */
  changeFileUpload(fileUpload) {
    this.setState({ fileUpload });
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
   * Change region
   */
  changeRegion(region) {
    this.setState({ region });
  }

  /**
   * Change custom endpoint
   */
  changeCustomEndpoint(customEndpoint) {
    this.setState({ customEndpoint });
  }

  /**
   * Change bucket name
   */
  changeBucket(bucket) {
    this.setState({ bucket });
  }

  /**
   * Change access key id
   */
  changeAccessKeyId(accessKeyId) {
    this.setState({ accessKeyId });
  }

  /**
   * Change secret access key
   */
  changeSecretAccessKey(secretAccessKey) {
    this.setState({ secretAccessKey });
  }

  /**
   * Change secret key
   */
  changeIsEnabledPlugins(isEnabledPlugins) {
    this.setState({ isEnabledPlugins });
  }

  /**
   * Update app setting
   * @memberOf AdminAppContainer
   * @return {Array} Appearance
   */
  async updateAppSettingHandler() {
    const response = await this.appContainer.apiv3.put('/app-settings/app-setting', {
      title: this.state.title,
      confidential: this.state.confidential,
      globalLang: this.state.globalLang,
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
    const response = await this.appContainer.apiv3.put('/app-settings/site-url-setting', {
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
    const response = await this.appContainer.apiv3.put('/app-settings/smtp-setting', {
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
    const response = await this.appContainer.apiv3.put('/app-settings/ses-setting', {
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
    return this.appContainer.apiv3.post('/app-settings/smtp-test');
  }

  /**
   * Update AWS setting
   * @memberOf AdminAppContainer
   * @return {Array} Appearance
   */
  async updateAwsSettingHandler() {
    const response = await this.appContainer.apiv3.put('/app-settings/aws-setting', {
      region: this.state.region,
      customEndpoint: this.state.customEndpoint,
      bucket: this.state.bucket,
      accessKeyId: this.state.accessKeyId,
      secretAccessKey: this.state.secretAccessKey,
    });
    const { awsSettingParams } = response.data;
    return awsSettingParams;
  }

  /**
   * Update plugin setting
   * @memberOf AdminAppContainer
   * @return {Array} Appearance
   */
  async updatePluginSettingHandler() {
    const response = await this.appContainer.apiv3.put('/app-settings/plugin-setting', {
      isEnabledPlugins: this.state.isEnabledPlugins,
    });
    const { pluginSettingParams } = response.data;
    return pluginSettingParams;
  }


}
