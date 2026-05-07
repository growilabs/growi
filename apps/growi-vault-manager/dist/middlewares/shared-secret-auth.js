import crypto from 'node:crypto';
import { Middleware, Next, Req, Res } from '@tsed/common';
import { __decorate, __metadata, __param } from 'tslib';

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
let SharedSecretAuth = class SharedSecretAuth {
  use(req, res, next) {
    const authHeader = req.headers.authorization;
    // Missing Authorization header → 401
    if (authHeader == null || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const token = authHeader.slice('Bearer '.length);
    const secret = process.env.VAULT_MANAGER_INTERNAL_SECRET;
    // Secret not configured — treat as misconfiguration; deny access
    if (secret == null || secret.length === 0) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    // Length mismatch reveals no timing information beyond "unequal length".
    // Revealing length alone is not exploitable for secret recovery, but we
    // still short-circuit to avoid the TypeError that crypto.timingSafeEqual
    // would throw when buffers have different byte lengths.
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);
    if (tokenBuf.length !== secretBuf.length) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    // Constant-time comparison to prevent timing attacks (requirement 7.5)
    const isValid = crypto.timingSafeEqual(tokenBuf, secretBuf);
    if (!isValid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }
};
__decorate(
  [
    __param(0, Req()),
    __param(1, Res()),
    __param(2, Next()),
    __metadata('design:type', Function),
    __metadata('design:paramtypes', [Object, Object, Function]),
    __metadata('design:returntype', void 0),
  ],
  SharedSecretAuth.prototype,
  'use',
  null,
);
SharedSecretAuth = __decorate([Middleware()], SharedSecretAuth);

export { SharedSecretAuth };
//# sourceMappingURL=shared-secret-auth.js.map
