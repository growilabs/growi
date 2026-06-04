import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { IUserSerializedSecurely } from '@growi/core/dist/models/serializers';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { NextFunction, Request, Response } from 'express';

import { SupportedAction } from '~/interfaces/activity';
import { AccessToken } from '~/server/models/access-token';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:features:growi-vault:middleware:vault-pat-auth',
);

// ============================================================================
// Types
// ============================================================================

/**
 * Audit-logger callback shape (subset of activityService.createActivity).
 * Wired by the router so the credential adapter can record auth-failure events
 * without depending on the full Crowi object.
 */
export type VaultCredentialAdapterAudit = (params: {
  ip: string | undefined;
  endpoint: string;
  action: string;
  user: string | undefined;
  snapshot: { username?: string };
}) => Promise<void>;

/**
 * The Express request shape the credential adapter populates on success.
 *
 * `user` mirrors what the standard accessTokenParser sets (a securely-serialized
 * user document) so the downstream `loginRequiredFactory` recognises an ACTIVE
 * user. `vaultScopes` carries the PAT's scopes for namespace computation (req 2.5).
 */
export type VaultAuthenticatedReq = Request & {
  user?: IUserSerializedSecurely<IUserHasId>;
  vaultScopes?: ReadonlyArray<string>;
};

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Extract the PAT from an HTTP Basic Auth header.
 *
 * git clients send credentials in the form:
 *   Authorization: Basic base64(anyusername:PAT)
 *
 * The username portion is intentionally ignored; only the password (PAT) is used.
 * Returns null when the header is absent or not a valid Basic Auth header.
 *
 * NOTE: rewiring this to the standard `extractAccessToken` (precedence
 * Bearer > X-GROWI-ACCESS-TOKEN > query > body) plus a Basic fallback is task
 * 26.3 — out of scope here. This task keeps the existing Basic extraction.
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
 * Resolve the user document and scopes for a raw PAT.
 *
 * Returns null when the token is not found / expired / revoked. Read-only users
 * are intentionally NOT rejected here: vault clone is a read operation, so we
 * resolve the token via `AccessToken.findUserIdByToken(...)` directly rather
 * than routing through the standard `parserForAccessToken`, which rejects
 * read-only users for write-API safety (documented intentional deviation,
 * design "意図的逸脱" — req 11.4).
 */
const resolvePatUser = async (
  pat: string,
): Promise<{ user: IUserHasId; scopes: ReadonlyArray<string> } | null> => {
  // We require the read:features:page scope for the lookup so an unscoped
  // hash match alone cannot resolve a user. Scope-based namespace restriction
  // is applied downstream by VaultNamespaceMapper (req 2.5).
  const tokenDoc = await AccessToken.findUserIdByToken(pat, [
    'read:features:page',
  ]);

  if (tokenDoc == null) {
    return null;
  }

  // Populate the user reference. The populated user carries `_id` and `status`,
  // both of which loginRequiredFactory inspects to admit an ACTIVE user.
  const { user } = await tokenDoc.populate<{ user: IUserHasId }>('user');
  if (user == null) {
    return null;
  }

  const scopes: ReadonlyArray<string> = tokenDoc.scopes ?? [];
  return { user, scopes };
};

/**
 * Send the git-compatible 401 challenge, end the response, and record an
 * auth-failure activity. The body intentionally carries no page content / list
 * / existence information (req 2.3). Recorded as VAULT_AUTH_FAILURE for
 * brute-force detection (req 10.4).
 */
const rejectWithChallenge = (
  req: Request,
  res: Response,
  audit: VaultCredentialAdapterAudit | undefined,
): void => {
  if (!res.headersSent) {
    res.setHeader('WWW-Authenticate', 'Basic realm="GROWI Vault"');
    res.status(401).end();
  } else {
    res.end();
  }

  audit?.({
    ip: req.ip,
    endpoint: req.originalUrl,
    action: SupportedAction.ACTION_VAULT_AUTH_FAILURE,
    user: undefined,
    snapshot: {},
  }).catch((err) =>
    logger.warn({ err }, 'Failed to record auth-failure activity'),
  );
};

// ============================================================================
// Credential adapter (seam #1)
// ============================================================================

/**
 * Express middleware factory for the vault credential adapter (seam #1).
 *
 * This is the ONLY git-specific authentication seam: it translates the git HTTP
 * Basic transport into the `req.user` shape the standard middleware chain
 * expects, then defers the guest / user-required decision to the downstream
 * `loginRequiredFactory` (the single source of truth — req 11). It does NOT
 * decide guest access itself.
 *
 * Behaviour:
 *  - No Authorization header → leave `req.user` unset (anonymous candidate) and
 *    call next(). The guest gate (loginRequiredFactory + aclService) decides.
 *  - Present but invalid / revoked / expired credential → respond 401 +
 *    `WWW-Authenticate: Basic realm="GROWI Vault"`, record VAULT_AUTH_FAILURE,
 *    and END (do not call next, do not fall through to anonymous). req 2.2 —
 *    loginRequiredFactory alone cannot do this: it would treat the missing user
 *    as anonymous and admit it when guests are allowed.
 *  - Valid credential → populate `req.user = serializeUserSecurely(user)` and
 *    stash `req.vaultScopes`, then call next(). Read-only users are allowed
 *    (intentional deviation — see resolvePatUser).
 */
export const createVaultCredentialAdapter = (
  audit?: VaultCredentialAdapterAudit,
) => {
  return async (
    req: VaultAuthenticatedReq,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization;

    // No credential presented: anonymous candidate. The downstream guest gate
    // owns the final decision — the adapter must not pre-empt it.
    if (authHeader == null) {
      next();
      return;
    }

    // A credential IS present. Any failure from here is a present-but-invalid
    // credential and MUST fail closed with a 401 challenge (req 2.2) rather than
    // silently degrading to anonymous.
    const pat = extractPatFromBasicAuth(authHeader);
    if (pat == null) {
      logger.debug('Invalid Authorization header format for vault PAT auth');
      rejectWithChallenge(req, res, audit);
      return;
    }

    let resolved: Awaited<ReturnType<typeof resolvePatUser>>;
    try {
      resolved = await resolvePatUser(pat);
    } catch (err) {
      logger.warn({ err }, 'Vault PAT resolution failed unexpectedly');
      rejectWithChallenge(req, res, audit);
      return;
    }

    if (resolved == null) {
      logger.debug(
        'Vault PAT authentication failed: token not found, expired, or revoked',
      );
      rejectWithChallenge(req, res, audit);
      return;
    }

    // Mirror the standard parser: serialize the user securely before exposing it
    // on the request (strips password / apiToken / email).
    req.user = serializeUserSecurely(resolved.user);
    req.vaultScopes = resolved.scopes;

    logger.debug('Vault PAT authentication succeeded');
    next();
  };
};

/**
 * Default singleton credential-adapter middleware (no audit callback).
 * Routers should prefer `createVaultCredentialAdapter(createActivity)` so
 * auth-failure events are recorded; this export exists for contexts without an
 * activity logger.
 */
export const vaultCredentialAdapter = createVaultCredentialAdapter();
