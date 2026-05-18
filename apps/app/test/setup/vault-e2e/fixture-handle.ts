/**
 * Service handles exposed by the vault E2E provisioning so individual tests
 * can drive the dispatcher / bootstrapper directly without going through
 * test-only HTTP endpoints (which would pollute production code paths).
 *
 * The provisioning code calls setVaultE2eHandle once. Tests then read it via
 * getVaultE2eHandle().
 */

import type { VaultBootstrapper } from '~/features/growi-vault/server/services/vault-bootstrapper';
import type { VaultDispatcher } from '~/features/growi-vault/server/services/vault-dispatcher';

export interface VaultE2eHandle {
  readonly dispatcher: VaultDispatcher;
  readonly bootstrapper: VaultBootstrapper;
}

let handle: VaultE2eHandle | undefined;

export function setVaultE2eHandle(h: VaultE2eHandle): void {
  handle = h;
}

export function getVaultE2eHandle(): VaultE2eHandle {
  if (handle == null) {
    throw new Error(
      'vault E2E handle not initialised. The vault E2E provisioning must run before this is called.',
    );
  }
  return handle;
}
