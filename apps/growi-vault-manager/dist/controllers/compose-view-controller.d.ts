/**
 * ComposeViewController
 *
 * Handles POST /internal/compose-view — the RPC endpoint that apps/app calls
 * to obtain (or refresh) a per-user view ref before initiating a git clone or
 * fetch operation.
 *
 * Authentication is enforced by SharedSecretAuth on every route in this
 * controller (requirement 7.1–7.5).
 *
 * On success the endpoint delegates to VaultViewComposer.compose() and returns
 * the viewRef and the commitOid at its tip (requirement 4.1).
 */
import type {
  ComposeViewRequest,
  ComposeViewResponse,
} from '@growi/core/dist/interfaces/vault';
import type { Logger } from '@tsed/logger';
export declare class ComposeViewController {
  private readonly logger;
  constructor(logger: Logger);
  /**
   * Compose (or retrieve from cache) the per-user view ref.
   *
   * SharedSecretAuth rejects unauthenticated callers with 401 before this
   * handler is invoked (requirement 7.1).
   *
   * @param body - userId and list of accessible namespaces from apps/app.
   * @returns viewRef and commitOid for the caller to use with git upload-pack.
   */
  composeView(body: ComposeViewRequest): Promise<ComposeViewResponse>;
}
