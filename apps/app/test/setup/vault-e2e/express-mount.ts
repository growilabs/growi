/**
 * Mount the vault gateway router on a minimal Express server bound to a
 * local ephemeral port. The integ tests exercise this server end-to-end
 * (HTTP → router → vault-manager-client → vault-manager → git).
 *
 * We intentionally do NOT mount the full apps/app server because:
 *   - That is a multi-minute production build dependency.
 *   - The vault gateway router exposes its entire contract through its
 *     own PAT auth middleware; it does not depend on apps/app's session
 *     pipeline.
 *
 * The contracts that DO depend on apps/app middleware (CSRF, login
 * sessions) live elsewhere and have their own tests.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';

import { createVaultGatewayRouter } from '~/features/growi-vault/server/routes/vault-gateway';

export interface MountedGatewayHandle {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

export async function mountVaultGatewayForTests(): Promise<MountedGatewayHandle> {
  const app: Express = express();
  app.use('/_vault/repo.git', createVaultGatewayRouter({}));

  const server: Server = await new Promise((resolve, reject) => {
    const s = createServer(app);
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });

  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const close = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { baseUrl, close };
}
