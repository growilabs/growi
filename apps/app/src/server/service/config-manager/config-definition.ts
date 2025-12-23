import { GrowiDeploymentType, GrowiServiceType } from '@growi/core/dist/consts';
import type {
  ConfigDefinition,
  Lang,
  NonBlankString,
} from '@growi/core/dist/interfaces';
import { defineConfig, toNonBlankString } from '@growi/core/dist/interfaces';
import type OpenAI from 'openai';

import { ActionGroupSize } from '~/interfaces/activity';
import { AttachmentMethodType } from '~/interfaces/attachment';
import type {
  IPageDeleteConfigValue,
  IPageDeleteConfigValueToProcessValidation,
} from '~/interfaces/page-delete-config';
import type { RegistrationMode } from '~/interfaces/registration-mode';
import { RehypeSanitizeType } from '~/interfaces/services/rehype-sanitize';

/*
 * Sort order for top level keys:
 *   1. autoInstall:*
 *   2. app:*
 *   3. security:*
 *   4. fileUpload:*, aws:*, gcs:*, azure:*, gridfs:*
 *   5. customize:*
 *   3. markdown:*
 *   N. (others)
 */
export const CONFIG_KEYS = [
  // Auto Install Settings
  'autoInstall:adminUsername',
  'autoInstall:adminName',
  'autoInstall:adminEmail',
  'autoInstall:adminPassword',
  'autoInstall:globalLang',
  'autoInstall:allowGuestMode',
  'autoInstall:serverDate',

  // App Settings
  'app:installed',
  'app:serviceInstanceId',
  'app:isV5Compatible',
  'app:isMaintenanceMode',
  'app:confidential',
  'app:title',
  'app:timezone',
  'app:globalLang',
  'app:fileUploadType',
  'app:plantumlUri',
  'app:drawioUri',
  'app:nchanUri',
  'app:siteUrl',
  'app:aiEnabled',
  'app:publishOpenAPI',
  'app:maxFileSize',
  'app:fileUploadTimeout',
  'app:fileUploadTotalLimit',
  'app:elasticsearchVersion',
  'app:elasticsearchUri',
  'app:elasticsearchRequestTimeout',
  'app:elasticsearchRejectUnauthorized',
  'app:elasticsearchMaxBodyLengthToIndex',
  'app:elasticsearchReindexBulkSize',
  'app:elasticsearchReindexOnBoot',
  'app:growiCloudUri',
  'app:growiAppIdForCloud',
  'app:ogpUri',
  'app:minPasswordLength',
  'app:auditLogEnabled',
  'app:activityExpirationSeconds',
  'app:auditLogActionGroupSize',
  'app:auditLogAdditionalActions',
  'app:auditLogExcludeActions',
  'app:serviceType',
  'app:deploymentType',
  'app:ssrMaxRevisionBodyLength',
  'app:wipPageExpirationSeconds',
  'app:openaiThreadDeletionCronMaxMinutesUntilRequest',
  'app:openaiVectorStoreFileDeletionCronMaxMinutesUntilRequest',
  'app:isReadOnlyForNewUser',

  // Security Settings
  'security:wikiMode',
  'security:sessionMaxAge',
  'security:userUpperLimit',
  'security:trustProxyBool',
  'security:trustProxyCsv',
  'security:trustProxyHops',
  'security:passport-local:isEnabled',
  'security:passport-local:isPasswordResetEnabled',
  'security:passport-local:isEmailAuthenticationEnabled',
  'security:passport-saml:isEnabled',
  'security:passport-saml:entryPoint',
  'security:passport-saml:issuer',
  'security:passport-saml:cert',
  'security:passport-saml:callbackUrl',
  'security:passport-saml:attrMapId',
  'security:passport-saml:attrMapUsername',
  'security:passport-saml:attrMapMail',
  'security:passport-saml:attrMapFirstName',
  'security:passport-saml:attrMapLastName',
  'security:passport-saml:ABLCRule',
  'security:passport-oidc:timeoutMultiplier',
  'security:passport-oidc:discoveryRetries',
  'security:passport-oidc:oidcClientClockTolerance',
  'security:passport-oidc:oidcIssuerTimeoutOption',
  'security:disableLinkSharing',
  'security:restrictGuestMode',
  'security:registrationMode',
  'security:registrationWhitelist',
  'security:list-policy:hideRestrictedByOwner',
  'security:list-policy:hideRestrictedByGroup',
  'security:pageDeletionAuthority',
  'security:pageCompleteDeletionAuthority',
  'security:pageRecursiveDeletionAuthority',
  'security:pageRecursiveCompleteDeletionAuthority',
  'security:isAllGroupMembershipRequiredForPageCompleteDeletion',
  'security:user-homepage-deletion:isEnabled',
  'security:user-homepage-deletion:isForceDeleteUserHomepageOnUserDeletion',
  'security:isRomUserAllowedToComment',
  'security:passport-ldap:isEnabled',
  'security:passport-ldap:serverUrl',
  'security:passport-ldap:isUserBind',
  'security:passport-ldap:bindDN',
  'security:passport-ldap:bindDNPassword',
  'security:passport-ldap:searchFilter',
  'security:passport-ldap:attrMapUsername',
  'security:passport-ldap:attrMapName',
  'security:passport-ldap:attrMapMail',
  'security:passport-ldap:groupSearchBase',
  'security:passport-ldap:groupSearchFilter',
  'security:passport-ldap:groupDnProperty',
  'security:passport-ldap:isSameUsernameTreatedAsIdenticalUser',
  'security:passport-saml:isSameUsernameTreatedAsIdenticalUser',
  'security:passport-saml:isSameEmailTreatedAsIdenticalUser',
  'security:passport-google:isEnabled',
  'security:passport-google:clientId',
  'security:passport-google:clientSecret',
  'security:passport-google:isSameUsernameTreatedAsIdenticalUser',
  'security:passport-google:isSameEmailTreatedAsIdenticalUser',
  'security:passport-github:isEnabled',
  'security:passport-github:clientId',
  'security:passport-github:clientSecret',
  'security:passport-github:isSameUsernameTreatedAsIdenticalUser',
  'security:passport-github:isSameEmailTreatedAsIdenticalUser',
  'security:passport-oidc:clientId',
  'security:passport-oidc:clientSecret',
  'security:passport-oidc:isEnabled',
  'security:passport-oidc:issuerHost',
  'security:passport-oidc:authorizationEndpoint',
  'security:passport-oidc:tokenEndpoint',
  'security:passport-oidc:revocationEndpoint',
  'security:passport-oidc:introspectionEndpoint',
  'security:passport-oidc:userInfoEndpoint',
  'security:passport-oidc:endSessionEndpoint',
  'security:passport-oidc:registrationEndpoint',
  'security:passport-oidc:jwksUri',
  'security:passport-oidc:isSameUsernameTreatedAsIdenticalUser',
  'security:passport-oidc:isSameEmailTreatedAsIdenticalUser',

  // File Upload Settings
  'fileUpload:local:useInternalRedirect',
  'fileUpload:local:internalRedirectPath',

  // AWS Settings
  'aws:referenceFileWithRelayMode',
  'aws:lifetimeSecForTemporaryUrl',
  'aws:s3ObjectCannedACL',
  'aws:s3Bucket',
  'aws:s3Region',
  'aws:s3AccessKeyId',
  'aws:s3SecretAccessKey',
  'aws:s3CustomEndpoint',

  // GCS Settings
  'gcs:apiKeyJsonPath',
  'gcs:bucket',
  'gcs:uploadNamespace',
  'gcs:lifetimeSecForTemporaryUrl',
  'gcs:referenceFileWithRelayMode',

  // Azure Settings
  'azure:lifetimeSecForTemporaryUrl',
  'azure:referenceFileWithRelayMode',
  'azure:tenantId',
  'azure:clientId',
  'azure:clientSecret',
  'azure:storageAccountName',
  'azure:storageContainerName',

  // GridFS Settings
  'gridfs:totalLimit',

  // Mail Settings
  'mail:from',
  'mail:transmissionMethod',
  'mail:smtpHost',
  'mail:smtpPort',
  'mail:smtpUser',
  'mail:smtpPassword',
  'mail:sesSecretAccessKey',
  'mail:sesAccessKeyId',

  // Customize Settings
  'customize:isEmailPublishedForNewUser',
  'customize:css',
  'customize:script',
  'customize:noscript',
  'customize:title',
  'customize:isDefaultLogo',
  'customize:highlightJsStyle',
  'customize:highlightJsStyleBorder',
  'customize:theme',
  'customize:isContainerFluid',
  'customize:isEnabledTimeline',
  'customize:isEnabledAttachTitleHeader',
  'customize:showPageLimitationS',
  'customize:showPageLimitationM',
  'customize:showPageLimitationL',
  'customize:showPageLimitationXL',
  'customize:isEnabledStaleNotification',
  'customize:isAllReplyShown',
  'customize:isSearchScopeChildrenAsDefault',
  'customize:showPageSideAuthors',
  'customize:isEnabledMarp',
  'customize:isSidebarCollapsedMode',

  // Markdown Settings
  'markdown:xss:tagWhitelist',
  'markdown:xss:attrWhitelist',
  'markdown:rehypeSanitize:isEnabledPrevention',
  'markdown:rehypeSanitize:option',
  'markdown:rehypeSanitize:tagNames',
  'markdown:rehypeSanitize:attributes',
  'markdown:isEnabledLinebreaks',
  'markdown:isEnabledLinebreaksInComments',
  'markdown:adminPreferredIndentSize',
  'markdown:isIndentSizeForced',

  // Slack Settings
  'slack:isIncomingWebhookPrioritized',
  'slack:incomingWebhookUrl',
  'slack:token',

  // Slackbot Settings
  'slackbot:currentBotType',
  'slackbot:proxyUri',
  'slackbot:withoutProxy:signingSecret',
  'slackbot:withoutProxy:botToken',
  'slackbot:withoutProxy:commandPermission',
  'slackbot:withoutProxy:eventActionsPermission',
  'slackbot:withProxy:saltForGtoP',
  'slackbot:withProxy:saltForPtoG',

  // OpenAI Settings
  'openai:serviceType',
  'openai:apiKey',
  'openai:assistantModel:chat',
  'openai:assistantModel:edit',
  'openai:threadDeletionCronExpression',
  'openai:threadDeletionBarchSize',
  'openai:threadDeletionApiCallInterval',
  'openai:vectorStoreFileDeletionCronExpression',
  'openai:vectorStoreFileDeletionBarchSize',
  'openai:vectorStoreFileDeletionApiCallInterval',
  'openai:limitLearnablePageCountPerAssistant',

  // OpenTelemetry Settings
  'otel:enabled',
  'otel:isAppSiteUrlHashed',
  'otel:anonymizeInBestEffort',
  'otel:serviceInstanceId',

  // S2S Messaging Pubsub Settings
  's2sMessagingPubsub:serverType',
  's2sMessagingPubsub:nchan:publishPath',
  's2sMessagingPubsub:nchan:subscribePath',
  's2sMessagingPubsub:nchan:channelId',

  // S2C Messaging Pubsub Settings
  's2cMessagingPubsub:connectionsLimit',
  's2cMessagingPubsub:connectionsLimitForAdmin',
  's2cMessagingPubsub:connectionsLimitForGuest',

  // Notification Settings
  'notification:owner-page:isEnabled',
  'notification:group-page:isEnabled',

  // External User Group Settings
  'external-user-group:ldap:groupMembershipAttributeType',
  'external-user-group:ldap:groupSearchBase',
  'external-user-group:ldap:groupMembershipAttribute',
  'external-user-group:ldap:groupChildGroupAttribute',
  'external-user-group:ldap:autoGenerateUserOnGroupSync',
  'external-user-group:ldap:preserveDeletedGroups',
  'external-user-group:ldap:groupNameAttribute',
  'external-user-group:ldap:groupDescriptionAttribute',
  'external-user-group:keycloak:host',
  'external-user-group:keycloak:groupRealm',
  'external-user-group:keycloak:groupSyncClientRealm',
  'external-user-group:keycloak:groupSyncClientID',
  'external-user-group:keycloak:groupSyncClientSecret',
  'external-user-group:keycloak:autoGenerateUserOnGroupSync',
  'external-user-group:keycloak:preserveDeletedGroups',
  'external-user-group:keycloak:groupDescriptionAttribute',

  // Control Flags for using only env vars
  'env:useOnlyEnvVars:app:siteUrl',
  'env:useOnlyEnvVars:app:fileUploadType',
  'env:useOnlyEnvVars:security:passport-local',
  'env:useOnlyEnvVars:security:passport-saml',
  'env:useOnlyEnvVars:gcs',
  'env:useOnlyEnvVars:azure',

  // Page Bulk Export Settings
  'app:bulkExportJobExpirationSeconds',
  'app:bulkExportDownloadExpirationSeconds',
  'app:pageBulkExportJobCronSchedule',
  'app:checkPageBulkExportJobInProgressCronSchedule',
  'app:pageBulkExportJobCleanUpCronSchedule',
  'app:pageBulkExportParallelExecLimit',
  'app:pageBulkExportPdfConverterUri',
  'app:isBulkExportPagesEnabled',
  'env:useOnlyEnvVars:app:isBulkExportPagesEnabled',

  // Access Token Settings
  'accessToken:deletionCronExpression',
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export const CONFIG_DEFINITIONS = {
  // Auto Install Settings
  'autoInstall:adminUsername': defineConfig<string | undefined>({
    envVarName: 'AUTO_INSTALL_ADMIN_USERNAME',
    defaultValue: undefined,
  }),
  'autoInstall:adminName': defineConfig<string | undefined>({
    envVarName: 'AUTO_INSTALL_ADMIN_NAME',
    defaultValue: undefined,
  }),
  'autoInstall:adminEmail': defineConfig<string | undefined>({
    envVarName: 'AUTO_INSTALL_ADMIN_EMAIL',
    defaultValue: undefined,
  }),
  'autoInstall:adminPassword': defineConfig<string | undefined>({
    envVarName: 'AUTO_INSTALL_ADMIN_PASSWORD',
    defaultValue: undefined,
    isSecret: true,
  }),
  'autoInstall:globalLang': defineConfig<Lang | undefined>({
    envVarName: 'AUTO_INSTALL_GLOBAL_LANG',
    defaultValue: undefined,
  }),
  'autoInstall:allowGuestMode': defineConfig<boolean>({
    envVarName: 'AUTO_INSTALL_ALLOW_GUEST_MODE',
    defaultValue: false,
  }),
  'autoInstall:serverDate': defineConfig<string | undefined>({
    envVarName: 'AUTO_INSTALL_SERVER_DATE',
    defaultValue: undefined,
  }),

  // App Settings
  'app:installed': defineConfig<boolean>({
    defaultValue: false,
  }),
  'app:serviceInstanceId': defineConfig<string>({
    defaultValue: '',
  }),
  'app:isV5Compatible': defineConfig<boolean>({
    defaultValue: false,
  }),
  'app:isMaintenanceMode': defineConfig<boolean>({
    defaultValue: false,
  }),
  'app:confidential': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'app:title': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'app:timezone': defineConfig<number | undefined>({
    defaultValue: undefined,
  }),
  'app:globalLang': defineConfig<string>({
    defaultValue: 'en_US',
  }),
  'app:fileUploadType': defineConfig<AttachmentMethodType>({
    envVarName: 'FILE_UPLOAD',
    defaultValue: AttachmentMethodType.aws,
  }),
  'app:plantumlUri': defineConfig<string>({
    envVarName: 'PLANTUML_URI',
    defaultValue: 'https://www.plantuml.com/plantuml',
  }),
  'app:drawioUri': defineConfig<string>({
    envVarName: 'DRAWIO_URI',
    defaultValue: 'https://embed.diagrams.net/',
  }),
  'app:nchanUri': defineConfig<string | undefined>({
    envVarName: 'NCHAN_URI',
    defaultValue: undefined,
  }),
  'app:siteUrl': defineConfig<string | undefined>({
    envVarName: 'APP_SITE_URL',
    defaultValue: undefined,
  }),
  'app:aiEnabled': defineConfig<boolean>({
    envVarName: 'AI_ENABLED',
    defaultValue: false,
  }),
  'app:publishOpenAPI': defineConfig<boolean>({
    envVarName: 'PUBLISH_OPEN_API',
    defaultValue: false,
  }),
  'app:maxFileSize': defineConfig<number>({
    envVarName: 'MAX_FILE_SIZE',
    defaultValue: Infinity,
  }),
  'app:fileUploadTimeout': defineConfig<number>({
    envVarName: 'FILE_UPLOAD_TIMEOUT',
    defaultValue: 10 * 60 * 1000, // 10 minutes
  }),
  'app:fileUploadTotalLimit': defineConfig<number>({
    envVarName: 'FILE_UPLOAD_TOTAL_LIMIT',
    defaultValue: Infinity,
  }),
  'app:elasticsearchVersion': defineConfig<7 | 8 | 9>({
    envVarName: 'ELASTICSEARCH_VERSION',
    defaultValue: 9,
  }),
  'app:elasticsearchUri': defineConfig<string | undefined>({
    envVarName: 'ELASTICSEARCH_URI',
    defaultValue: undefined,
  }),
  'app:elasticsearchRequestTimeout': defineConfig<number>({
    envVarName: 'ELASTICSEARCH_REQUEST_TIMEOUT',
    defaultValue: 8000,
  }),
  'app:elasticsearchRejectUnauthorized': defineConfig<boolean>({
    envVarName: 'ELASTICSEARCH_REJECT_UNAUTHORIZED',
    defaultValue: false,
  }),
  'app:elasticsearchMaxBodyLengthToIndex': defineConfig<number>({
    envVarName: 'ELASTICSEARCH_MAX_BODY_LENGTH_TO_INDEX',
    defaultValue: 100000,
  }),
  'app:elasticsearchReindexBulkSize': defineConfig<number>({
    envVarName: 'ELASTICSEARCH_REINDEX_BULK_SIZE',
    defaultValue: 100,
  }),
  'app:elasticsearchReindexOnBoot': defineConfig<boolean>({
    envVarName: 'ELASTICSEARCH_REINDEX_ON_BOOT',
    defaultValue: false,
  }),
  'app:growiCloudUri': defineConfig<string | undefined>({
    envVarName: 'GROWI_CLOUD_URI',
    defaultValue: undefined,
  }),
  'app:growiAppIdForCloud': defineConfig<number | undefined>({
    envVarName: 'GROWI_APP_ID_FOR_GROWI_CLOUD',
    defaultValue: undefined,
  }),
  'app:ogpUri': defineConfig<string | undefined>({
    envVarName: 'OGP_URI',
    defaultValue: undefined,
  }),
  'app:minPasswordLength': defineConfig<number>({
    envVarName: 'MIN_PASSWORD_LENGTH',
    defaultValue: 8,
  }),
  'app:auditLogEnabled': defineConfig<boolean>({
    envVarName: 'AUDIT_LOG_ENABLED',
    defaultValue: false,
  }),
  'app:activityExpirationSeconds': defineConfig<number>({
    envVarName: 'ACTIVITY_EXPIRATION_SECONDS',
    defaultValue: 2592000,
  }),
  'app:auditLogActionGroupSize': defineConfig<ActionGroupSize>({
    envVarName: 'AUDIT_LOG_ACTION_GROUP_SIZE',
    defaultValue: ActionGroupSize.Small,
  }),
  'app:auditLogAdditionalActions': defineConfig<string | undefined>({
    envVarName: 'AUDIT_LOG_ADDITIONAL_ACTIONS',
    defaultValue: undefined,
  }),
  'app:auditLogExcludeActions': defineConfig<string | undefined>({
    envVarName: 'AUDIT_LOG_EXCLUDE_ACTIONS',
    defaultValue: undefined,
  }),
  'app:serviceType': defineConfig<GrowiServiceType>({
    envVarName: 'SERVICE_TYPE',
    defaultValue: GrowiServiceType.onPremise,
  }),
  'app:deploymentType': defineConfig<GrowiDeploymentType>({
    envVarName: 'DEPLOYMENT_TYPE',
    defaultValue: GrowiDeploymentType.node,
  }),
  'app:ssrMaxRevisionBodyLength': defineConfig<number>({
    envVarName: 'SSR_MAX_REVISION_BODY_LENGTH',
    defaultValue: 3000,
  }),
  'app:wipPageExpirationSeconds': defineConfig<number>({
    envVarName: 'WIP_PAGE_EXPIRATION_SECONDS',
    defaultValue: 172800,
  }),
  'app:openaiThreadDeletionCronMaxMinutesUntilRequest': defineConfig<number>({
    envVarName: 'OPENAI_THREAD_DELETION_CRON_MAX_MINUTES_UNTIL_REQUEST',
    defaultValue: 30,
  }),
  'app:openaiVectorStoreFileDeletionCronMaxMinutesUntilRequest':
    defineConfig<number>({
      envVarName:
        'OPENAI_VECTOR_STORE_FILE_DELETION_CRON_MAX_MINUTES_UNTIL_REQUEST',
      defaultValue: 30,
    }),
  'app:isReadOnlyForNewUser': defineConfig<boolean>({
    envVarName: 'DEFAULT_USER_READONLY',
    defaultValue: false,
  }),

  // Security Settings
  'security:wikiMode': defineConfig<string | undefined>({
    envVarName: 'FORCE_WIKI_MODE',
    defaultValue: undefined,
  }),
  'security:sessionMaxAge': defineConfig<number | undefined>({
    envVarName: 'SESSION_MAX_AGE',
    defaultValue: undefined,
    isSecret: true,
  }),
  'security:userUpperLimit': defineConfig<number>({
    envVarName: 'USER_UPPER_LIMIT',
    defaultValue: Infinity,
  }),
  'security:trustProxyBool': defineConfig<boolean | undefined>({
    envVarName: 'TRUST_PROXY_BOOL',
    defaultValue: undefined,
    isSecret: true,
  }),
  'security:trustProxyCsv': defineConfig<string | undefined>({
    envVarName: 'TRUST_PROXY_CSV',
    defaultValue: undefined,
    isSecret: true,
  }),
  'security:trustProxyHops': defineConfig<number | undefined>({
    envVarName: 'TRUST_PROXY_HOPS',
    defaultValue: undefined,
    isSecret: true,
  }),
  'security:passport-local:isEnabled': defineConfig<boolean>({
    envVarName: 'LOCAL_STRATEGY_ENABLED',
    defaultValue: true,
  }),
  'security:passport-local:isPasswordResetEnabled': defineConfig<boolean>({
    envVarName: 'LOCAL_STRATEGY_PASSWORD_RESET_ENABLED',
    defaultValue: true,
  }),
  'security:passport-local:isEmailAuthenticationEnabled': defineConfig<boolean>(
    {
      envVarName: 'LOCAL_STRATEGY_EMAIL_AUTHENTICATION_ENABLED',
      defaultValue: false,
    },
  ),
  'security:passport-saml:isEnabled': defineConfig<boolean>({
    envVarName: 'SAML_ENABLED',
    defaultValue: false,
  }),
  'security:passport-saml:callbackUrl': defineConfig<string | undefined>({
    envVarName: 'SAML_CALLBACK_URI',
    defaultValue: undefined,
  }),
  'security:passport-saml:attrMapId': defineConfig<string | undefined>({
    envVarName: 'SAML_ATTR_MAPPING_ID',
    defaultValue: undefined,
  }),
  'security:passport-saml:attrMapUsername': defineConfig<string | undefined>({
    envVarName: 'SAML_ATTR_MAPPING_USERNAME',
    defaultValue: undefined,
  }),
  'security:passport-saml:attrMapMail': defineConfig<string | undefined>({
    envVarName: 'SAML_ATTR_MAPPING_MAIL',
    defaultValue: undefined,
  }),
  'security:passport-saml:attrMapFirstName': defineConfig<string | undefined>({
    envVarName: 'SAML_ATTR_MAPPING_FIRST_NAME',
    defaultValue: undefined,
  }),
  'security:passport-saml:attrMapLastName': defineConfig<string | undefined>({
    envVarName: 'SAML_ATTR_MAPPING_LAST_NAME',
    defaultValue: undefined,
  }),
  'security:passport-saml:ABLCRule': defineConfig<string | undefined>({
    envVarName: 'SAML_ABLC_RULE',
    defaultValue: undefined,
  }),
  'security:passport-saml:entryPoint': defineConfig<string | undefined>({
    envVarName: 'SAML_ENTRY_POINT',
    defaultValue: undefined,
  }),
  'security:passport-saml:issuer': defineConfig<string | undefined>({
    envVarName: 'SAML_ISSUER',
    defaultValue: undefined,
  }),
  'security:passport-saml:cert': defineConfig<string | undefined>({
    envVarName: 'SAML_CERT',
    defaultValue: undefined,
  }),
  'security:passport-oidc:timeoutMultiplier': defineConfig<number>({
    envVarName: 'OIDC_TIMEOUT_MULTIPLIER',
    defaultValue: 1.5,
  }),
  'security:passport-oidc:discoveryRetries': defineConfig<number>({
    envVarName: 'OIDC_DISCOVERY_RETRIES',
    defaultValue: 3,
  }),
  'security:passport-oidc:oidcClientClockTolerance': defineConfig<number>({
    envVarName: 'OIDC_CLIENT_CLOCK_TOLERANCE',
    defaultValue: 60,
  }),
  'security:passport-oidc:oidcIssuerTimeoutOption': defineConfig<number>({
    envVarName: 'OIDC_ISSUER_TIMEOUT_OPTION',
    defaultValue: 5000,
  }),
  'security:disableLinkSharing': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:restrictGuestMode': defineConfig<string>({
    defaultValue: 'Deny',
  }),
  'security:registrationMode': defineConfig<RegistrationMode>({
    defaultValue: 'Open',
  }),
  'security:registrationWhitelist': defineConfig<string[]>({
    defaultValue: [],
  }),
  'security:list-policy:hideRestrictedByOwner': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:list-policy:hideRestrictedByGroup': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:pageDeletionAuthority': defineConfig<
    IPageDeleteConfigValueToProcessValidation | undefined
  >({
    defaultValue: undefined,
  }),
  'security:pageCompleteDeletionAuthority': defineConfig<
    IPageDeleteConfigValueToProcessValidation | undefined
  >({
    defaultValue: undefined,
  }),
  'security:pageRecursiveDeletionAuthority': defineConfig<
    IPageDeleteConfigValue | undefined
  >({
    defaultValue: undefined,
  }),
  'security:pageRecursiveCompleteDeletionAuthority': defineConfig<
    IPageDeleteConfigValue | undefined
  >({
    defaultValue: undefined,
  }),
  'security:isAllGroupMembershipRequiredForPageCompleteDeletion':
    defineConfig<boolean>({
      defaultValue: true,
    }),
  'security:user-homepage-deletion:isEnabled': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:user-homepage-deletion:isForceDeleteUserHomepageOnUserDeletion':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:isRomUserAllowedToComment': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:passport-ldap:isEnabled': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:passport-ldap:serverUrl': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:isUserBind': defineConfig<boolean | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:bindDN': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:bindDNPassword': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:searchFilter': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:attrMapUsername': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:attrMapName': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:attrMapMail': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:groupSearchBase': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:groupSearchFilter': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:groupDnProperty': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-ldap:isSameUsernameTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:passport-saml:isSameEmailTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:passport-saml:isSameUsernameTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:passport-google:isEnabled': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:passport-google:clientId': defineConfig<NonBlankString | undefined>(
    {
      defaultValue: undefined,
    },
  ),
  'security:passport-google:clientSecret': defineConfig<
    NonBlankString | undefined
  >({
    defaultValue: undefined,
  }),
  'security:passport-google:isSameUsernameTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:passport-google:isSameEmailTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:passport-github:isEnabled': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:passport-github:clientId': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-github:clientSecret': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-github:isSameUsernameTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:passport-github:isSameEmailTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:passport-oidc:clientId': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-oidc:clientSecret': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-oidc:isEnabled': defineConfig<boolean>({
    defaultValue: false,
  }),
  'security:passport-oidc:issuerHost': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-oidc:authorizationEndpoint': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'security:passport-oidc:tokenEndpoint': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-oidc:revocationEndpoint': defineConfig<string | undefined>(
    {
      defaultValue: undefined,
    },
  ),
  'security:passport-oidc:introspectionEndpoint': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'security:passport-oidc:userInfoEndpoint': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-oidc:endSessionEndpoint': defineConfig<string | undefined>(
    {
      defaultValue: undefined,
    },
  ),
  'security:passport-oidc:registrationEndpoint': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'security:passport-oidc:jwksUri': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'security:passport-oidc:isSameUsernameTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'security:passport-oidc:isSameEmailTreatedAsIdenticalUser':
    defineConfig<boolean>({
      defaultValue: false,
    }),

  // File Upload Settings
  'fileUpload:local:useInternalRedirect': defineConfig<boolean>({
    envVarName: 'FILE_UPLOAD_LOCAL_USE_INTERNAL_REDIRECT',
    defaultValue: false,
  }),
  'fileUpload:local:internalRedirectPath': defineConfig<string>({
    envVarName: 'FILE_UPLOAD_LOCAL_INTERNAL_REDIRECT_PATH',
    defaultValue: '/growi-internal/',
  }),

  // AWS Settings
  'aws:referenceFileWithRelayMode': defineConfig<boolean>({
    envVarName: 'S3_REFERENCE_FILE_WITH_RELAY_MODE',
    defaultValue: false,
  }),
  'aws:lifetimeSecForTemporaryUrl': defineConfig<number>({
    envVarName: 'S3_LIFETIME_SEC_FOR_TEMPORARY_URL',
    defaultValue: 120,
  }),
  'aws:s3ObjectCannedACL': defineConfig<string | undefined>({
    envVarName: 'S3_OBJECT_ACL',
    defaultValue: undefined,
  }),
  'aws:s3Bucket': defineConfig<NonBlankString>({
    defaultValue: toNonBlankString('growi'),
  }),
  'aws:s3Region': defineConfig<NonBlankString>({
    defaultValue: toNonBlankString('ap-northeast-1'),
  }),
  'aws:s3AccessKeyId': defineConfig<NonBlankString | undefined>({
    defaultValue: undefined,
  }),
  'aws:s3SecretAccessKey': defineConfig<NonBlankString | undefined>({
    defaultValue: undefined,
    isSecret: true,
  }),
  'aws:s3CustomEndpoint': defineConfig<NonBlankString | undefined>({
    defaultValue: undefined,
  }),

  // GCS Settings
  'gcs:apiKeyJsonPath': defineConfig<NonBlankString | undefined>({
    envVarName: 'GCS_API_KEY_JSON_PATH',
    defaultValue: undefined,
  }),
  'gcs:bucket': defineConfig<NonBlankString | undefined>({
    envVarName: 'GCS_BUCKET',
    defaultValue: undefined,
  }),
  'gcs:uploadNamespace': defineConfig<string>({
    envVarName: 'GCS_UPLOAD_NAMESPACE',
    defaultValue: '',
  }),
  'gcs:lifetimeSecForTemporaryUrl': defineConfig<number>({
    envVarName: 'GCS_LIFETIME_SEC_FOR_TEMPORARY_URL',
    defaultValue: 120,
  }),
  'gcs:referenceFileWithRelayMode': defineConfig<boolean>({
    envVarName: 'GCS_REFERENCE_FILE_WITH_RELAY_MODE',
    defaultValue: false,
  }),

  // Azure Settings
  'azure:lifetimeSecForTemporaryUrl': defineConfig<number>({
    envVarName: 'AZURE_LIFETIME_SEC_FOR_TEMPORARY_URL',
    defaultValue: 120,
  }),
  'azure:referenceFileWithRelayMode': defineConfig<boolean>({
    envVarName: 'AZURE_REFERENCE_FILE_WITH_RELAY_MODE',
    defaultValue: false,
  }),
  'azure:tenantId': defineConfig<NonBlankString | undefined>({
    envVarName: 'AZURE_TENANT_ID',
    defaultValue: undefined,
  }),
  'azure:clientId': defineConfig<NonBlankString | undefined>({
    envVarName: 'AZURE_CLIENT_ID',
    defaultValue: undefined,
  }),
  'azure:clientSecret': defineConfig<NonBlankString | undefined>({
    envVarName: 'AZURE_CLIENT_SECRET',
    defaultValue: undefined,
    isSecret: true,
  }),
  'azure:storageAccountName': defineConfig<string | undefined>({
    envVarName: 'AZURE_STORAGE_ACCOUNT_NAME',
    defaultValue: undefined,
  }),
  'azure:storageContainerName': defineConfig<string | undefined>({
    envVarName: 'AZURE_STORAGE_CONTAINER_NAME',
    defaultValue: undefined,
  }),

  // GridFS Settings
  'gridfs:totalLimit': defineConfig<number | undefined>({
    envVarName: 'MONGO_GRIDFS_TOTAL_LIMIT',
    defaultValue: undefined,
  }),

  // Mail Settings
  'mail:from': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'mail:transmissionMethod': defineConfig<'smtp' | 'ses' | undefined>({
    defaultValue: undefined,
  }),
  'mail:smtpHost': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'mail:smtpPort': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'mail:smtpUser': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'mail:smtpPassword': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'mail:sesAccessKeyId': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'mail:sesSecretAccessKey': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),

  // Customize Settings
  'customize:isEmailPublishedForNewUser': defineConfig<boolean>({
    envVarName: 'DEFAULT_EMAIL_PUBLISHED',
    defaultValue: true,
  }),
  'customize:css': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'customize:script': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'customize:noscript': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'customize:title': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'customize:isDefaultLogo': defineConfig<boolean>({
    defaultValue: true,
  }),
  'customize:highlightJsStyle': defineConfig<string>({
    defaultValue: 'github',
  }),
  'customize:highlightJsStyleBorder': defineConfig<boolean>({
    defaultValue: false,
  }),
  'customize:theme': defineConfig<string>({
    defaultValue: 'default',
  }),
  'customize:isContainerFluid': defineConfig<boolean>({
    defaultValue: false,
  }),
  'customize:isEnabledTimeline': defineConfig<boolean>({
    defaultValue: true,
  }),
  'customize:isEnabledAttachTitleHeader': defineConfig<boolean>({
    defaultValue: false,
  }),
  'customize:showPageLimitationS': defineConfig<number>({
    defaultValue: 20,
  }),
  'customize:showPageLimitationM': defineConfig<number>({
    defaultValue: 10,
  }),
  'customize:showPageLimitationL': defineConfig<number>({
    defaultValue: 50,
  }),
  'customize:showPageLimitationXL': defineConfig<number>({
    defaultValue: 20,
  }),
  'customize:isEnabledStaleNotification': defineConfig<boolean>({
    defaultValue: false,
  }),
  'customize:isAllReplyShown': defineConfig<boolean>({
    defaultValue: false,
  }),
  'customize:isSearchScopeChildrenAsDefault': defineConfig<boolean>({
    defaultValue: false,
  }),
  'customize:showPageSideAuthors': defineConfig<boolean>({
    defaultValue: false,
  }),
  'customize:isEnabledMarp': defineConfig<boolean>({
    defaultValue: false,
  }),
  'customize:isSidebarCollapsedMode': defineConfig<boolean>({
    defaultValue: false,
  }),
  // Markdown Settings
  'markdown:xss:tagWhitelist': defineConfig<string[]>({
    defaultValue: [],
  }),
  'markdown:xss:attrWhitelist': defineConfig<string[]>({
    defaultValue: [],
  }),
  'markdown:rehypeSanitize:isEnabledPrevention': defineConfig<boolean>({
    defaultValue: true,
  }),
  'markdown:rehypeSanitize:option': defineConfig<RehypeSanitizeType>({
    defaultValue: RehypeSanitizeType.RECOMMENDED,
  }),
  'markdown:rehypeSanitize:tagNames': defineConfig<string[]>({
    defaultValue: [],
  }),
  'markdown:rehypeSanitize:attributes': defineConfig<string>({
    defaultValue: '{}',
  }),
  'markdown:isEnabledLinebreaks': defineConfig<boolean>({
    defaultValue: false,
  }),
  'markdown:isEnabledLinebreaksInComments': defineConfig<boolean>({
    defaultValue: true,
  }),
  'markdown:adminPreferredIndentSize': defineConfig<number>({
    defaultValue: 4,
  }),
  'markdown:isIndentSizeForced': defineConfig<boolean>({
    defaultValue: false,
  }),

  // Slack Settings
  'slack:isIncomingWebhookPrioritized': defineConfig<boolean>({
    defaultValue: false,
  }),
  'slack:incomingWebhookUrl': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'slack:token': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),

  // Slackbot Settings
  'slackbot:currentBotType': defineConfig<string | undefined>({
    envVarName: 'SLACKBOT_TYPE',
    defaultValue: undefined,
  }),
  'slackbot:proxyUri': defineConfig<string | undefined>({
    envVarName: 'SLACKBOT_INTEGRATION_PROXY_URI',
    defaultValue: undefined,
  }),
  'slackbot:withoutProxy:signingSecret': defineConfig<string | undefined>({
    envVarName: 'SLACKBOT_WITHOUT_PROXY_SIGNING_SECRET',
    defaultValue: undefined,
    isSecret: true,
  }),
  'slackbot:withoutProxy:botToken': defineConfig<string | undefined>({
    envVarName: 'SLACKBOT_WITHOUT_PROXY_BOT_TOKEN',
    defaultValue: undefined,
    isSecret: true,
  }),
  'slackbot:withoutProxy:commandPermission': defineConfig<string | undefined>({
    envVarName: 'SLACKBOT_WITHOUT_PROXY_COMMAND_PERMISSION',
    defaultValue: undefined,
  }),
  'slackbot:withoutProxy:eventActionsPermission': defineConfig<
    string | undefined
  >({
    envVarName: 'SLACKBOT_WITHOUT_PROXY_EVENT_ACTIONS_PERMISSION',
    defaultValue: undefined,
  }),
  'slackbot:withProxy:saltForGtoP': defineConfig<string>({
    envVarName: 'SLACKBOT_WITH_PROXY_SALT_FOR_GTOP',
    defaultValue: 'gtop',
    isSecret: true,
  }),
  'slackbot:withProxy:saltForPtoG': defineConfig<string>({
    envVarName: 'SLACKBOT_WITH_PROXY_SALT_FOR_PTOG',
    defaultValue: 'ptog',
    isSecret: true,
  }),

  // OpenAI Settings
  'openai:serviceType': defineConfig<'openai' | 'azure-openai'>({
    envVarName: 'OPENAI_SERVICE_TYPE',
    defaultValue: 'openai',
  }),
  'openai:apiKey': defineConfig<string | undefined>({
    envVarName: 'OPENAI_API_KEY',
    defaultValue: undefined,
    isSecret: true,
  }),
  'openai:assistantModel:chat': defineConfig<OpenAI.Chat.ChatModel>({
    envVarName: 'OPENAI_CHAT_ASSISTANT_MODEL',
    defaultValue: 'gpt-4.1-mini',
  }),
  'openai:assistantModel:edit': defineConfig<OpenAI.Chat.ChatModel>({
    envVarName: 'OPENAI_EDITOR_ASSISTANT_MODEL',
    defaultValue: 'gpt-4.1-mini',
  }),
  'openai:threadDeletionCronExpression': defineConfig<string>({
    envVarName: 'OPENAI_THREAD_DELETION_CRON_EXPRESSION',
    defaultValue: '0 * * * *',
  }),
  'openai:threadDeletionBarchSize': defineConfig<number>({
    envVarName: 'OPENAI_THREAD_DELETION_BARCH_SIZE',
    defaultValue: 100,
  }),
  'openai:threadDeletionApiCallInterval': defineConfig<number>({
    envVarName: 'OPENAI_THREAD_DELETION_API_CALL_INTERVAL',
    defaultValue: 36000,
  }),
  'openai:vectorStoreFileDeletionCronExpression': defineConfig<string>({
    envVarName: 'OPENAI_VECTOR_STORE_FILE_DELETION_CRON_EXPRESSION',
    defaultValue: '0 * * * *',
  }),
  'openai:vectorStoreFileDeletionBarchSize': defineConfig<number>({
    envVarName: 'OPENAI_VECTOR_STORE_FILE_DELETION_BARCH_SIZE',
    defaultValue: 100,
  }),
  'openai:vectorStoreFileDeletionApiCallInterval': defineConfig<number>({
    envVarName: 'OPENAI_VECTOR_STORE_FILE_DELETION_API_CALL_INTERVAL',
    defaultValue: 36000,
  }),
  'openai:limitLearnablePageCountPerAssistant': defineConfig<number>({
    envVarName: 'OPENAI_LIMIT_LEARNABLE_PAGE_COUNT_PER_ASSISTANT',
    defaultValue: 3000,
  }),

  // OpenTelemetry Settings
  'otel:enabled': defineConfig<boolean>({
    envVarName: 'OPENTELEMETRY_ENABLED',
    defaultValue: true,
  }),
  'otel:isAppSiteUrlHashed': defineConfig<boolean>({
    envVarName: 'OPENTELEMETRY_IS_APP_SITE_URL_HASHED',
    defaultValue: false,
  }),
  'otel:anonymizeInBestEffort': defineConfig<boolean>({
    envVarName: 'OPENTELEMETRY_ANONYMIZE_IN_BEST_EFFORT',
    defaultValue: false,
  }),
  'otel:serviceInstanceId': defineConfig<string | undefined>({
    envVarName: 'OPENTELEMETRY_SERVICE_INSTANCE_ID',
    defaultValue: undefined,
  }),

  // S2S Messaging Pubsub Settings
  's2sMessagingPubsub:serverType': defineConfig<string | undefined>({
    envVarName: 'S2SMSG_PUBSUB_SERVER_TYPE',
    defaultValue: undefined,
  }),
  's2sMessagingPubsub:nchan:publishPath': defineConfig<string>({
    envVarName: 'S2SMSG_PUBSUB_NCHAN_PUBLISH_PATH',
    defaultValue: '/pubsub',
  }),
  's2sMessagingPubsub:nchan:subscribePath': defineConfig<string>({
    envVarName: 'S2SMSG_PUBSUB_NCHAN_SUBSCRIBE_PATH',
    defaultValue: '/pubsub',
  }),
  's2sMessagingPubsub:nchan:channelId': defineConfig<string | undefined>({
    envVarName: 'S2SMSG_PUBSUB_NCHAN_CHANNEL_ID',
    defaultValue: undefined,
  }),

  // S2C Messaging Pubsub Settings
  's2cMessagingPubsub:connectionsLimit': defineConfig<number>({
    envVarName: 'S2CMSG_PUBSUB_CONNECTIONS_LIMIT',
    defaultValue: 5000,
  }),
  's2cMessagingPubsub:connectionsLimitForAdmin': defineConfig<number>({
    envVarName: 'S2CMSG_PUBSUB_CONNECTIONS_LIMIT_FOR_ADMIN',
    defaultValue: 100,
  }),
  's2cMessagingPubsub:connectionsLimitForGuest': defineConfig<number>({
    envVarName: 'S2CMSG_PUBSUB_CONNECTIONS_LIMIT_FOR_GUEST',
    defaultValue: 2000,
  }),

  // Notification Settings
  'notification:owner-page:isEnabled': defineConfig<boolean>({
    defaultValue: false,
  }),
  'notification:group-page:isEnabled': defineConfig<boolean>({
    defaultValue: false,
  }),

  // External User Group Settings
  'external-user-group:ldap:groupMembershipAttributeType': defineConfig<string>(
    {
      defaultValue: 'DN',
    },
  ),
  'external-user-group:ldap:groupSearchBase': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'external-user-group:ldap:groupMembershipAttribute': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'external-user-group:ldap:groupChildGroupAttribute': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'external-user-group:ldap:autoGenerateUserOnGroupSync': defineConfig<boolean>(
    {
      defaultValue: false,
    },
  ),
  'external-user-group:ldap:preserveDeletedGroups': defineConfig<boolean>({
    defaultValue: false,
  }),
  'external-user-group:ldap:groupNameAttribute': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'external-user-group:ldap:groupDescriptionAttribute': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'external-user-group:keycloak:host': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'external-user-group:keycloak:groupRealm': defineConfig<string | undefined>({
    defaultValue: undefined,
  }),
  'external-user-group:keycloak:groupSyncClientRealm': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'external-user-group:keycloak:groupSyncClientID': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),
  'external-user-group:keycloak:groupSyncClientSecret': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
    isSecret: true,
  }),
  'external-user-group:keycloak:autoGenerateUserOnGroupSync':
    defineConfig<boolean>({
      defaultValue: false,
    }),
  'external-user-group:keycloak:preserveDeletedGroups': defineConfig<boolean>({
    defaultValue: false,
  }),
  'external-user-group:keycloak:groupDescriptionAttribute': defineConfig<
    string | undefined
  >({
    defaultValue: undefined,
  }),

  // Control Flags for Env Vars
  'env:useOnlyEnvVars:app:siteUrl': defineConfig<boolean>({
    envVarName: 'APP_SITE_URL_USES_ONLY_ENV_VARS',
    defaultValue: false,
  }),
  'env:useOnlyEnvVars:app:fileUploadType': defineConfig<boolean>({
    envVarName: 'FILE_UPLOAD_USES_ONLY_ENV_VAR_FOR_FILE_UPLOAD_TYPE',
    defaultValue: false,
  }),
  'env:useOnlyEnvVars:security:passport-local': defineConfig<boolean>({
    envVarName: 'LOCAL_STRATEGY_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS',
    defaultValue: false,
  }),
  'env:useOnlyEnvVars:security:passport-saml': defineConfig<boolean>({
    envVarName: 'SAML_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS',
    defaultValue: false,
  }),
  'env:useOnlyEnvVars:gcs': defineConfig<boolean>({
    envVarName: 'GCS_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS',
    defaultValue: false,
  }),
  'env:useOnlyEnvVars:azure': defineConfig<boolean>({
    envVarName: 'AZURE_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS',
    defaultValue: false,
  }),
  'app:bulkExportJobExpirationSeconds': defineConfig<number>({
    envVarName: 'BULK_EXPORT_JOB_EXPIRATION_SECONDS',
    defaultValue: 86400,
  }),
  'app:bulkExportDownloadExpirationSeconds': defineConfig<number>({
    envVarName: 'BULK_EXPORT_DOWNLOAD_EXPIRATION_SECONDS',
    defaultValue: 259200,
  }),
  'app:pageBulkExportJobCronSchedule': defineConfig<string>({
    envVarName: 'BULK_EXPORT_JOB_CRON_SCHEDULE',
    defaultValue: '*/10 * * * * *',
  }),
  'app:checkPageBulkExportJobInProgressCronSchedule': defineConfig<string>({
    envVarName: 'CHECK_PAGE_BULK_EXPORT_JOB_IN_PROGRESS_CRON_SCHEDULE',
    defaultValue: '*/3 * * * *',
  }),
  'app:pageBulkExportJobCleanUpCronSchedule': defineConfig<string>({
    envVarName: 'BULK_EXPORT_JOB_CLEAN_UP_CRON_SCHEDULE',
    defaultValue: '*/10 * * * *',
  }),
  'app:pageBulkExportParallelExecLimit': defineConfig<number>({
    envVarName: 'BULK_EXPORT_PARALLEL_EXEC_LIMIT',
    defaultValue: 5,
  }),
  'app:pageBulkExportPdfConverterUri': defineConfig<string | undefined>({
    envVarName: 'BULK_EXPORT_PDF_CONVERTER_URI',
    defaultValue: undefined,
  }),
  'app:isBulkExportPagesEnabled': defineConfig<boolean>({
    envVarName: 'BULK_EXPORT_PAGES_ENABLED',
    defaultValue: true,
  }),
  'env:useOnlyEnvVars:app:isBulkExportPagesEnabled': defineConfig<boolean>({
    envVarName: 'BULK_EXPORT_PAGES_ENABLED_USES_ONLY_ENV_VARS',
    defaultValue: false,
  }),

  // Access Token Settings
  'accessToken:deletionCronExpression': defineConfig<string>({
    envVarName: 'ACCESS_TOKEN_DELETION_CRON_EXPRESSION',
    defaultValue: '0 15 * * *',
  }),
} as const;

export type ConfigValues = {
  [K in ConfigKey]: (typeof CONFIG_DEFINITIONS)[K] extends ConfigDefinition<
    infer T
  >
    ? T
    : never;
};

// Define groups of settings that use only environment variables
export interface EnvOnlyGroup {
  controlKey: ConfigKey;
  targetKeys: ConfigKey[];
}

export const ENV_ONLY_GROUPS: EnvOnlyGroup[] = [
  {
    controlKey: 'env:useOnlyEnvVars:app:siteUrl',
    targetKeys: ['app:siteUrl'],
  },
  {
    controlKey: 'env:useOnlyEnvVars:app:fileUploadType',
    targetKeys: ['app:fileUploadType'],
  },
  {
    controlKey: 'env:useOnlyEnvVars:security:passport-local',
    targetKeys: ['security:passport-local:isEnabled'],
  },
  {
    controlKey: 'env:useOnlyEnvVars:security:passport-saml',
    targetKeys: [
      'security:passport-saml:isEnabled',
      'security:passport-saml:entryPoint',
      'security:passport-saml:issuer',
      'security:passport-saml:cert',
    ],
  },
  {
    controlKey: 'env:useOnlyEnvVars:gcs',
    targetKeys: ['gcs:apiKeyJsonPath', 'gcs:bucket', 'gcs:uploadNamespace'],
  },
  {
    controlKey: 'env:useOnlyEnvVars:azure',
    targetKeys: [
      'azure:tenantId',
      'azure:clientId',
      'azure:clientSecret',
      'azure:storageAccountName',
      'azure:storageContainerName',
    ],
  },
];
