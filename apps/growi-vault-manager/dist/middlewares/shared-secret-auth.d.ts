import type { NextFunction, Request, Response } from 'express';
/**
 * Ts.ED middleware that enforces service-to-service authentication via a shared secret.
 *
 * Validates the `Authorization: Bearer <token>` header against the
 * `VAULT_MANAGER_INTERNAL_SECRET` environment variable using a constant-time
 * comparison to prevent timing attacks (requirement 7.5).
 *
 * Returns 401 Unauthorized when:
 * - The Authorization header is absent (requirement 7.3)
 * - The bearer token does not match the configured secret (requirement 7.2)
 *
 * The secret is read exclusively from the environment variable and is never
 * stored in MongoDB or any other persistent store (requirement 7.4).
 */
export declare class SharedSecretAuth {
  use(req: Request, res: Response, next: NextFunction): void;
}
