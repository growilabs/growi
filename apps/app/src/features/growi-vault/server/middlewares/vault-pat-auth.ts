import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { IUserSerializedSecurely } from '@growi/core/dist/models/serializers';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { NextFunction, Request, Response } from 'express';

import { SupportedAction } from '~/interfaces/activity';
// extractAccessToken / X_GROWI_ACCESS_TOKEN_HEADER_NAME are NOT re-exported by the
// access-token-parser barrel — import them directly from the file (PR #11244).
import { extractAccessToken } from '~/server/middlewares/access-token-parser/extract-access-token';
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
 * This is the git-native fallback only. PAT resolution first goes through the
 * standard `extractAccessToken` (precedence Bearer > X-GROWI-ACCESS-TOKEN >
 * query > body — req 2.6); this Basic extraction is consulted only when that
 * yields nothing, so a reverse-proxy's own Basic credential does not collide
 * with the vault PAT.
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
 * Token resolution shares the GROWI single source of truth (req 2.6):
 *   PAT = extractAccessToken(req)                  // Bearer > X-GROWI-ACCESS-TOKEN > query > body
 *      ?? <password part of Authorization: Basic>  // git-native fallback
 * This lets a reverse proxy keep `Authorization` for its own Basic credential
 * and forward the PAT via `X-GROWI-ACCESS-TOKEN`, while a proxy-less git client
 * still authenticates with `Authorization: Basic base64(x:PAT)`.
 *
 * Behaviour:
 *  - No credential from ANY source → leave `req.user` unset (anonymous
 *    candidate) and call next(). The guest gate (loginRequiredFactory +
 *    aclService) decides.
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

    // `extractAccessToken` reads `req.query.access_token` and `req.body.access_token`
    // as the last items in its precedence chain. The `/vault.git/*` routes have NO
    // body parser (the POST handler streams `req` itself, never `req.body`), so
    // `req.body` — and sometimes `req.query` — is undefined and would throw
    // "Cannot read properties of undefined". Default them to `{}` before calling.
    // Mutating `req.body` here is SAFE precisely because the handler never reads it.
    if (req.body == null) {
      req.body = {};
    }
    if (req.query == null) {
      // biome-ignore lint/suspicious/noExplicitAny: Express types `query` as non-optional, but it is absent without a query parser
      (req as any).query = {};
    }

    // Resolve the PAT via the standard precedence first (Bearer >
    // X-GROWI-ACCESS-TOKEN > query > body), falling back to the git-native Basic
    // password so proxy-less clients keep working (req 2.6).
    const pat = extractAccessToken(req) ?? extractPatFromBasicAuth(authHeader);

    // No credential from any source: anonymous candidate. The downstream guest
    // gate owns the final decision — the adapter must not pre-empt it.
    if (pat == null) {
      next();
      return;
    }

    // A credential IS present. Any failure from here is a present-but-invalid
    // credential and MUST fail closed with a 401 challenge (req 2.2) rather than
    // silently degrading to anonymous.

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
