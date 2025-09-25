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

      fileUploadType: '',
      envFileUploadType: '',
      isFixedFileUploadByEnvVar: false,

      gcsUseOnlyEnvVars: false,
      gcsApiKeyJsonPath: '',
      envGcsApiKeyJsonPath: '',
      gcsBucket: '',
      envGcsBucket: '',
      gcsUploadNamespace: '',
      envGcsUploadNamespace: '',
      gcsReferenceFileWithRelayMode: false,

      s3Region: '',
      s3CustomEndpoint: '',
      s3Bucket: '',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
      s3ReferenceFileWithRelayMode: false,

      azureReferenceFileWithRelayMode: false,
      azureUseOnlyEnvVars: false,
      azureTenantId: '',
      azureClientId: '',
      azureClientSecret: '',
      azureStorageAccountName: '',
      azureStorageContainerName: '',
      envAzureTenantId: '',
      envAzureClientId: '',
      envAzureClientSecret: '',
      envAzureStorageAccountName: '',
      envAzureStorageContainerName: '',

      isEnabledPlugins: true,

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

      fileUploadType: appSettingsParams.fileUploadType,
      envFileUploadType: appSettingsParams.envFileUploadType,
      useOnlyEnvVarForFileUploadType: appSettingsParams.useOnlyEnvVarForFileUploadType,

      s3Region: appSettingsParams.s3Region,
      s3CustomEndpoint: appSettingsParams.s3CustomEndpoint,
      s3Bucket: appSettingsParams.s3Bucket,
      s3AccessKeyId: appSettingsParams.s3AccessKeyId,
      s3ReferenceFileWithRelayMode: appSettingsParams.s3ReferenceFileWithRelayMode,

      gcsUseOnlyEnvVars: appSettingsParams.gcsUseOnlyEnvVars,
      gcsApiKeyJsonPath: appSettingsParams.gcsApiKeyJsonPath,
      gcsBucket: appSettingsParams.gcsBucket,
      gcsUploadNamespace: appSettingsParams.gcsUploadNamespace,
      gcsReferenceFileWithRelayMode: appSettingsParams.gcsReferenceFileWithRelayMode,
      envGcsApiKeyJsonPath: appSettingsParams.envGcsApiKeyJsonPath,
      envGcsBucket: appSettingsParams.envGcsBucket,
      envGcsUploadNamespace: appSettingsParams.envGcsUploadNamespace,

      azureUseOnlyEnvVars: appSettingsParams.azureUseOnlyEnvVars,
      azureTenantId: appSettingsParams.azureTenantId,
      azureClientId: appSettingsParams.azureClientId,
      azureClientSecret: appSettingsParams.azureClientSecret,
      azureStorageAccountName: appSettingsParams.azureStorageAccountName,
      azureStorageContainerName: appSettingsParams.azureStorageContainerName,
      azureReferenceFileWithRelayMode: appSettingsParams.azureReferenceFileWithRelayMode,
      envAzureTenantId: appSettingsParams.envAzureTenantId,
      envAzureClientId: appSettingsParams.envAzureClientId,
      envAzureClientSecret: appSettingsParams.envAzureClientSecret,
      envAzureStorageAccountName: appSettingsParams.envAzureStorageAccountName,
      envAzureStorageContainerName: appSettingsParams.envAzureStorageContainerName,

      isEnabledPlugins: appSettingsParams.isEnabledPlugins,
      isMaintenanceMode: appSettingsParams.isMaintenanceMode,
    });

    // if useOnlyEnvVarForFileUploadType is true, get fileUploadType from only env var and make the forms fixed.
    // and if env var 'FILE_UPLOAD' is null, envFileUploadType is 'aws' that is default value of 'FILE_UPLOAD'.
    if (appSettingsParams.useOnlyEnvVarForFileUploadType) {
      this.setState({ fileUploadType: appSettingsParams.envFileUploadType });
      this.setState({ isFixedFileUploadByEnvVar: true });
    }
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
   * Change s3Region
   */
  changeS3Region(s3Region) {
    this.setState({ s3Region });
  }

  /**
   * Change s3CustomEndpoint
   */
  changeS3CustomEndpoint(s3CustomEndpoint) {
    this.setState({ s3CustomEndpoint });
  }

  /**
   * Change fileUploadType
   */
  changeFileUploadType(fileUploadType) {
    this.setState({ fileUploadType });
  }

  /**
   * Change region
   */
  changeS3Bucket(s3Bucket) {
    this.setState({ s3Bucket });
  }

  /**
   * Change access key id
   */
  changeS3AccessKeyId(s3AccessKeyId) {
    this.setState({ s3AccessKeyId });
  }

  /**
   * Change secret access key
   */
  changeS3SecretAccessKey(s3SecretAccessKey) {
    this.setState({ s3SecretAccessKey });
  }

  /**
   * Change s3ReferenceFileWithRelayMode
   */
  changeS3ReferenceFileWithRelayMode(s3ReferenceFileWithRelayMode) {
    this.setState({ s3ReferenceFileWithRelayMode });
  }

  /**
   * Change gcsApiKeyJsonPath
   */
  changeGcsApiKeyJsonPath(gcsApiKeyJsonPath) {
    this.setState({ gcsApiKeyJsonPath });
  }

  /**
   * Change gcsBucket
   */
  changeGcsBucket(gcsBucket) {
    this.setState({ gcsBucket });
  }

  /**
   * Change gcsUploadNamespace
   */
  changeGcsUploadNamespace(gcsUploadNamespace) {
    this.setState({ gcsUploadNamespace });
  }

  /**
   * Change gcsReferenceFileWithRelayMode
   */
  changeGcsReferenceFileWithRelayMode(gcsReferenceFileWithRelayMode) {
    this.setState({ gcsReferenceFileWithRelayMode });
  }

  /**
   * Change azureReferenceFileWithRelayMode
   */
  changeAzureReferenceFileWithRelayMode(azureReferenceFileWithRelayMode) {
    this.setState({ azureReferenceFileWithRelayMode });
  }

  /**
   * Change azureTenantId
   */
  changeAzureTenantId(azureTenantId) {
    this.setState({ azureTenantId });
  }

  /**
   * Change azureClientId
   */
  changeAzureClientId(azureClientId) {
    this.setState({ azureClientId });
  }

  /**
   * Change azureClientSecret
   */
  changeAzureClientSecret(azureClientSecret) {
    this.setState({ azureClientSecret });
  }

  /**
   * Change azureStorageAccountName
   */
  changeAzureStorageAccountName(azureStorageAccountName) {
    this.setState({ azureStorageAccountName });
  }

  /**
   * Change azureStorageContainerName
   */
  changeAzureStorageContainerName(azureStorageContainerName) {
    this.setState({ azureStorageContainerName });
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
   * Update updateFileUploadSettingHandler
   * @memberOf AdminAppContainer
   */
  async updateFileUploadSettingHandler() {
    const { fileUploadType } = this.state;

    const requestParams = {
      fileUploadType,
    };

    if (fileUploadType === 'gcs') {
      requestParams.gcsApiKeyJsonPath = this.state.gcsApiKeyJsonPath;
      requestParams.gcsBucket = this.state.gcsBucket;
      requestParams.gcsUploadNamespace = this.state.gcsUploadNamespace;
      requestParams.gcsReferenceFileWithRelayMode = this.state.gcsReferenceFileWithRelayMode;
    }

    if (fileUploadType === 'aws') {
      requestParams.s3Region = this.state.s3Region;
      requestParams.s3CustomEndpoint = this.state.s3CustomEndpoint;
      requestParams.s3Bucket = this.state.s3Bucket;
      requestParams.s3AccessKeyId = this.state.s3AccessKeyId;
      requestParams.s3SecretAccessKey = this.state.s3SecretAccessKey;
      requestParams.s3ReferenceFileWithRelayMode = this.state.s3ReferenceFileWithRelayMode;
    }

    if (fileUploadType === 'azure') {
      requestParams.azureTenantId = this.state.azureTenantId;
      requestParams.azureClientId = this.state.azureClientId;
      requestParams.azureClientSecret = this.state.azureClientSecret;
      requestParams.azureStorageAccountName = this.state.azureStorageAccountName;
      requestParams.azureStorageContainerName = this.state.azureStorageContainerName;
      requestParams.azureReferenceFileWithRelayMode = this.state.azureReferenceFileWithRelayMode;
    }

    const response = await apiv3Put('/app-settings/file-upload-setting', requestParams);
    const { responseParams } = response.data;
    return this.setState(responseParams);
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
