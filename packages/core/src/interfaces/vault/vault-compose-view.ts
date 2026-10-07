import type { Namespace } from './vault-instruction.js';

/** Request body for the POST /internal/compose-view RPC call to vault-manager. */
export interface ComposeViewRequest {
  readonly userId: string | null;
  readonly namespaces: ReadonlyArray<Namespace>;
}

/** Response from the compose-view RPC. viewRef identifies the per-user ephemeral view. */
export interface ComposeViewResponse {
  readonly viewRef: string;
  readonly commitOid: string;
}
