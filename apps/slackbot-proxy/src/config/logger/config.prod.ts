import type { LoggerConfig } from '@growi/logger';

const config: LoggerConfig = {
  default: 'info',

  // 'express-session': 'debug',

  /*
   * configure level for server
   */
  // 'express:*': 'debug',
  // 'slackbot-proxy:*': 'debug',
};

export default config;
