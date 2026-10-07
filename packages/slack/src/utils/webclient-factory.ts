import { LogLevel, WebClient, type WebClientOptions } from '@slack/web-api';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel: LogLevel = isProduction ? LogLevel.DEBUG : LogLevel.INFO;

/**
 * Generate WebClilent instance
 * @param token
 * @param serverUri Slack Bot Token or Proxy Server URI
 * @param headers
 */
export function generateWebClient(
  token?: string,
  serverUri?: string,
  headers?: { [key: string]: string },
): WebClient;

/**
 * Generate WebClilent instance
 * @param token
 * @param opts
 */
export function generateWebClient(
  token?: string,
  opts?: WebClientOptions,
): WebClient;

// biome-ignore lint/suspicious/noExplicitAny: ignore
export function generateWebClient(token?: string, ...args: any[]): WebClient {
  if (typeof args[0] === 'string') {
    return new WebClient(token, {
      logLevel,
      slackApiUrl: args[0],
      headers: args[1],
    });
  }

  return new WebClient(token, { logLevel, ...args });
}
