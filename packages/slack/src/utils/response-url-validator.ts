import { URL } from 'node:url';

const ALLOWED_SLACK_HOST = 'hooks.slack.com';

export function isValidResponseUrl(
  responseUrl: string,
  slackbotProxyUri?: string,
): boolean {
  try {
    const parsedUrl = new URL(responseUrl);

    // Case 1: Direct to Slack
    if (
      parsedUrl.protocol === 'https:' &&
      parsedUrl.hostname === ALLOWED_SLACK_HOST
    ) {
      return true;
    }

    // Case 2: Via slackbot-proxy
    if (slackbotProxyUri) {
      const parsedProxyUri = new URL(slackbotProxyUri);

      if (
        (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') &&
        parsedUrl.hostname === parsedProxyUri.hostname &&
        parsedUrl.pathname === '/g2s/respond'
      ) {
        const slackResponseUrlParam =
          parsedUrl.searchParams.get('response_url');
        if (slackResponseUrlParam) {
          // Recursively validate the response_url parameter
          return isValidResponseUrl(slackResponseUrlParam); // No proxy URI for the inner check
        }
      }
    }

    return false;
  } catch {
    // Invalid URL format
    return false;
  }
}
