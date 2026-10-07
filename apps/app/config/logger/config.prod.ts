import type { LoggerConfig } from '@growi/logger';

const config: LoggerConfig = {
  default: 'info',

  'growi:routes:login-passport': 'debug',
  'growi:service:PassportService': 'debug',
};

export default config;
