import { createHash } from 'node:crypto';
import {
  getUsernameByPath,
  isCreatablePage,
  isPermalink,
  isUserPage,
  isUsersHomepage,
} from '@growi/core/dist/utils/page-path-utils';
import { diag } from '@opentelemetry/api';

const logger = diag.createComponentLogger({
  namespace: 'growi:anonymization:hash-page-path',
});

function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex').substring(0, 16);
}

/**
 * Decode a percent-encoded URL pathname so that differently-encoded forms of
 * the same page (e.g. %E6 / %e6) are judged and hashed identically
 * @returns The decoded pathname, or the pathname as-is if it is malformed
 */
export const decodePathname = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

// Mirrors the single-character restrictions in @growi/core's restrictedPatternsToCreate
const CHARS_RESTRICTED_IN_PAGE_NAME = /[\^$*+#<>%?\\]/g;

/**
 * Whether the decoded path is a page route that must be anonymized.
 * Characters forbidden in page names only limit what can be created; a request
 * containing them still targets a page route and must not leak its path.
 */
export const isPageRoute = (decodedPath: string): boolean => {
  return isCreatablePage(
    decodedPath.replace(CHARS_RESTRICTED_IN_PAGE_NAME, '_'),
  );
};

/**
 * Hash a decoded page path. Permalinks (ObjectId) are returned as-is, and the
 * leading/trailing slashes are preserved.
 */
export const hashPagePath = (decodedPath: string): string => {
  try {
    if (isPermalink(decodedPath)) {
      return decodedPath;
    }

    if (isUserPage(decodedPath)) {
      const username = getUsernameByPath(decodedPath);

      if (isUsersHomepage(decodedPath) && username) {
        return `/user/[USERNAME_HASHED:${hashString(username)}]`;
      }

      if (username) {
        const hashedUsername = hashString(username);
        const remainingPath = decodedPath.replace(`/user/${username}`, '');

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

    const cleanPath = decodedPath.replace(/^\/+|\/+$/g, '');

    if (!cleanPath) {
      return decodedPath;
    }

    const leadingSlash = decodedPath.startsWith('/') ? '/' : '';
    const trailingSlash =
      decodedPath.endsWith('/') && decodedPath.length > 1 ? '/' : '';

    return `${leadingSlash}[HASHED:${hashString(cleanPath)}]${trailingSlash}`;
  } catch (error) {
    logger.warn(`Failed to hash page path: ${error}`);
    return decodedPath;
  }
};
