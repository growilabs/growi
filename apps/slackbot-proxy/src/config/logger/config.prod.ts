import { UniversalBunyanConfig } from 'universal-bunyan';

const config: UniversalBunyanConfig = {
  default: 'info',

  // 'express-session': 'debug',

  /*
   * configure level for server
   */
  // 'express:*': 'debug',
  // 'slackbot-proxy:*': 'debug',
};

export default config;
