import type { Request, Response } from 'express';

import { AccessToken } from '~/server/models/access-token';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:features:growi-vault:middleware:vault-pat-auth',
);

/**
 * The result of PAT authentication for the GROWI Vault.
 * null means anonymous access — only public namespaces are accessible.
 */
export type VaultAuthResult = {
  readonly userId: string;
  readonly scopes: ReadonlyArray<string>;
} | null;

/**
 * Interface for the VaultPatAuth authenticator.
 * Implemented as a module-level factory to keep it testable without classes.
 */
export interface VaultPatAuth {
  authenticate(req: Request, res: Response): Promise<VaultAuthResult>;
}

/**
 * Extract the PAT from an HTTP Basic Auth header.
 *
 * git clients send credentials in the form:
 *   Authorization: Basic base64(anyusername:PAT)
 *
 * The username portion is intentionally ignored; only the password (PAT) is used.
 * Returns null when the header is absent or not a valid Basic Auth header.
 */
const extractPatFromBasicAuth = (
  authHeader: string | undefined,
): string | null => {
  if (authHeader == null) {
    return null;
  }

  if (!authHeader.startsWith('Basic ')) {
    return null;
  }

  const base64Credentials = authHeader.substring(6); // Remove 'Basic ' prefix
  let credentials: string;
  try {
    credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1) {
    // No colon means no password portion
    return null;
  }

  // The portion after the first colon is the PAT (password).
  // Username (before the colon) is ignored.
  const pat = credentials.substring(colonIndex + 1);
  return pat.length > 0 ? pat : null;
};

/**
 * Set the WWW-Authenticate header required by RFC 7617 for HTTP Basic Auth challenges.
 */
const setBasicAuthChallenge = (res: Response): void => {
  res.setHeader('WWW-Authenticate', 'Basic realm="GROWI Vault"');
};

/**
 * Factory function that creates a VaultPatAuth authenticator.
 *
 * The authenticator validates HTTP Basic Auth credentials where the password
 * portion is treated as a GROWI Personal Access Token (PAT).
 *
 * Behaviour:
 *  - Authorization header absent → returns null (anonymous, public namespaces only)
 *  - Valid PAT → returns { userId, scopes }
 *  - Invalid / revoked / expired PAT → sets 401 + WWW-Authenticate header and throws
 */
export const createVaultPatAuth = (): VaultPatAuth => {
  return {
    async authenticate(req: Request, res: Response): Promise<VaultAuthResult> {
      const authHeader = req.headers.authorization;

      // No Authorization header: anonymous access.
      if (authHeader == null) {
        return null;
      }

      // Header is present but not a valid Basic Auth credential.
      const pat = extractPatFromBasicAuth(authHeader);
      if (pat == null) {
        logger.debug('Invalid Authorization header format for vault PAT auth');
        setBasicAuthChallenge(res);
        res.status(401);
        throw new Error('Unauthorized');
      }

      // Validate the PAT against the AccessToken model.
      // We pass an empty scopes array for the initial lookup so that we can
      // retrieve the token's actual scopes from the document without requiring
      // a specific scope to be present. The scope enforcement for namespace
      // access is delegated to VaultNamespaceMapper.
      //
      // NOTE: findUserIdByToken requires at least one requiredScope, so we use
      // a wildcard-equivalent lookup instead: direct hash lookup without scope filter.
      const tokenDoc = await AccessToken.findUserIdByToken(pat, [
        'read:features:page',
      ]);

      if (tokenDoc == null) {
        logger.debug(
          'Vault PAT authentication failed: token not found or expired',
        );
        setBasicAuthChallenge(res);
        res.status(401);
        // Error message intentionally contains no page or resource information (req 2.3)
        throw new Error('Unauthorized');
      }

      // Populate the user reference to get the userId string.
      const { user } = await tokenDoc.populate<{
        user: { _id: { toString(): string } };
      }>('user');
      const userId = user._id.toString();

      // Retrieve scopes from the token document so callers can apply scope-based
      // namespace restrictions (req 2.5).
      const scopes: ReadonlyArray<string> = tokenDoc.scopes ?? [];

      logger.debug('Vault PAT authentication succeeded');
      return { userId, scopes };
    },
  };
};

/**
 * Default singleton instance of VaultPatAuth.
 * Import and use this in route handlers that need to authenticate git clients.
 */
export const vaultPatAuth = createVaultPatAuth();
