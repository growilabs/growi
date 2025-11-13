import {
  getUsernameByPath,
  isCreatablePage,
  isPermalink,
  isUserPage,
  isUsersHomepage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import { diag } from '@opentelemetry/api';
import { createHash } from 'crypto';
import type { IncomingMessage } from 'http';

import { ATTR_HTTP_TARGET } from '../../semconv';
import type { AnonymizationModule } from '../interfaces/anonymization-module';

const logger = diag.createComponentLogger({
  namespace: 'growi:anonymization:page-access-handler',
});

/**
 * Create a hash of the given string
 */
function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex').substring(0, 16);
}

/**
 * Anonymize URL path by hashing non-ObjectId paths
 * @param urlPath - The URL path to anonymize
 * @returns Anonymized URL path
 */
function anonymizeUrlPath(urlPath: string): string {
  try {
    // If it's a permalink (ObjectId), don't anonymize
    if (isPermalink(urlPath)) {
      return urlPath;
    }

    // Handle user pages specially
    if (isUserPage(urlPath)) {
      const username = getUsernameByPath(urlPath);

      if (isUsersHomepage(urlPath) && username) {
        // For user homepage (/user/john), anonymize only the username
        const hashedUsername = hashString(username);
        return `/user/[USERNAME_HASHED:${hashedUsername}]`;
      }

      if (username) {
        // For user sub-pages (/user/john/projects), anonymize username and remaining path separately
        const hashedUsername = hashString(username);
        const remainingPath = urlPath.replace(`/user/${username}`, '');

        if (remainingPath) {
          const cleanRemainingPath = remainingPath.replace(/^\/+|\/+$/g, '');
          const hashedRemainingPath = hashString(cleanRemainingPath);
          const leadingSlash = remainingPath.startsWith('/') ? '/' : '';
          const trailingSlash =
            remainingPath.endsWith('/') && remainingPath.length > 1 ? '/' : '';

          return `/user/[USERNAME_HASHED:${hashedUsername}]${leadingSlash}[HASHED:${hashedRemainingPath}]${trailingSlash}`;
        }
      }
    }

    // For regular pages, use the original logic
    const cleanPath = urlPath.replace(/^\/+|\/+$/g, '');

    // If empty path, return as-is
    if (!cleanPath) {
      return urlPath;
    }

    // Hash the path and return with original slash structure
    const hashedPath = hashString(cleanPath);
    const leadingSlash = urlPath.startsWith('/') ? '/' : '';
    const trailingSlash =
      urlPath.endsWith('/') && urlPath.length > 1 ? '/' : '';

    return `${leadingSlash}[HASHED:${hashedPath}]${trailingSlash}`;
  } catch (error) {
    logger.warn(`Failed to anonymize URL path: ${error}`);
    return urlPath;
  }
}

/**
 * Page access anonymization module for non-API requests
 */
export const pageAccessModule: AnonymizationModule = {
  /**
   * Check if this module can handle page access requests (non-API)
   */
  canHandle(url: string): boolean {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const path = parsedUrl.pathname;

      // Exclude root path
      if (path === '/') return false;

      // Exclude static resources first
      if (
        path.includes('/static/') ||
        path.includes('/_next/') ||
        path.includes('/favicon') ||
        path.includes('/assets/') ||
        path.includes('.')
      ) {
        // Exclude file extensions (images, css, js, etc.)
        return false;
      }

      // Exclude users top page (/user)
      if (isUsersTopPage(path)) return false;

      // Exclude permalink (ObjectId) paths
      if (isPermalink(path)) return false;

      // Handle user pages (including homepage and sub-pages)
      if (isUserPage(path)) return true;

      // Use GROWI's isCreatablePage logic to determine if this is a valid page path
      // This excludes API endpoints, system paths, etc.
      return isCreatablePage(path);
    } catch {
      // If URL parsing fails, don't handle it
      return false;
    }
  },

  /**
   * Handle anonymization for page access requests
   */
  handle(request: IncomingMessage, url: string): Record<string, string> | null {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const originalPath = parsedUrl.pathname;

      // Anonymize the URL path
      const anonymizedPath = anonymizeUrlPath(originalPath);

      // Only return attributes if path was actually anonymized
      if (anonymizedPath !== originalPath) {
        const anonymizedUrl = anonymizedPath + parsedUrl.search;

        logger.debug(`Anonymized page access URL: ${url} -> ${anonymizedUrl}`);

        return {
          [ATTR_HTTP_TARGET]: anonymizedUrl,
        };
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to anonymize page access URL: ${error}`);
      return null;
    }
  },
};
