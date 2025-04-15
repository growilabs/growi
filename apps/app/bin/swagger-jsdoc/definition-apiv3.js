const pkg = require('../../package.json');

module.exports = {
  openapi: '3.0.1',
  info: {
    title: 'GROWI REST API v3',
    version: pkg.version,
  },
  servers: [
    {
      url: 'https://demo.growi.org/_api/v3',
    },
  ],
  security: [
    {
      api_key: [],
    },
  ],
  components: {
    securitySchemes: {
      api_key: {
        type: 'apiKey',
        name: 'access_token',
        in: 'query',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
      },
      transferHeaderAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-growi-transfer-key',
      },
    },
  },
  'x-tagGroups': [
    {
      name: 'User API',
      tags: [
        'Attachment',
        'Bookmarks',
        'BookmarkFolders',
        'Page',
        'Pages',
        'PageListing',
        'Revisions',
        'ShareLinks',
        'Users',
        'UserUISettings',
        '',
      ],
    },
    {
      name: 'User Personal Settings API',
      tags: [
        'GeneralSetting',
        'EditorSetting',
        'InAppNotificationSettings',
        '',
        '',
        '',
        '',
        '',
      ],
    },
    {
      name: 'System Management API',
      tags: [
        'Home',
        'Activity',
        'AdminHome',
        'AppSettings',
        'ExternalUserGroups',
        'SecuritySetting',
        'MarkDownSetting',
        'CustomizeSetting',
        'Import',
        'Export',
        'GROWI to GROWI Transfer',
        'MongoDB',
        'NotificationSetting',
        'Plugins',
        'Questionnaire',
        'QuestionnaireSetting',
        'SlackIntegration',
        'SlackIntegrationSettings',
        'SlackIntegrationSettings (with proxy)',
        'SlackIntegrationSettings (without proxy)',
        'SlackIntegrationLegacySetting',
        'ShareLink Management',
        'Templates',
        'Staff',
        'UserGroupRelations',
        'UserGroups',
        'Users Management',
        'FullTextSearch Management',
        'Install',
      ],
    },
    {
      name: 'Public API',
      tags: [
        'Healthcheck',
        'Statistics',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    },
  ],
};
