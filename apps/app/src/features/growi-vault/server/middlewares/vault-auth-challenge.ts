import type { Request, Response } from 'express';

import { SupportedAction } from '~/interfaces/activity';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:features:growi-vault:middleware:vault-auth-challenge',
);

/** Audit-logger callback shape (subset of activityService.createActivity). */
export type VaultActivityRecorder = (params: {
  ip: string | undefined;
  endpoint: string;
  action: string;
  user: string | undefined;
  snapshot: { username?: string };
}) => Promise<void>;

/**
 * Build the single response for a `/vault.git` request whose user could not be
 * identified: the git-native challenge `401 + WWW-Authenticate: Basic
 * realm="GROWI Vault"` with an empty body (req 2.3), plus a VAULT_AUTH_FAILURE
 * audit record for brute-force detection (req 10.4).
 */
export const createVaultAuthChallenge = (
  recordActivity: VaultActivityRecorder | undefined,
) => {
  return (req: Request, res: Response): void => {
    if (!res.headersSent) {
      res.setHeader('WWW-Authenticate', 'Basic realm="GROWI Vault"');
      res.status(401).end();
    } else {
      res.end();
    }

    recordActivity?.({
      ip: req.ip,
      endpoint: req.originalUrl,
      action: SupportedAction.ACTION_VAULT_AUTH_FAILURE,
      user: undefined,
      snapshot: {},
    }).catch((err) =>
      logger.warn({ err }, 'Failed to record auth-failure activity'),
    );
  };
};
