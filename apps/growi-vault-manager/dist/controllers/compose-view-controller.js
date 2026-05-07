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

import { BodyParams, UseBefore } from '@tsed/common';
import { Controller } from '@tsed/di';
import { InternalServerError } from '@tsed/exceptions';
import { Logger } from '@tsed/logger';
import { Post, Returns } from '@tsed/schema';
import { __decorate, __metadata, __param } from 'tslib';

import { SharedSecretAuth } from '../middlewares/shared-secret-auth.js';
import * as VaultViewComposer from '../services/vault-view-composer.js';

let ComposeViewController = class ComposeViewController {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  /**
   * Compose (or retrieve from cache) the per-user view ref.
   *
   * SharedSecretAuth rejects unauthenticated callers with 401 before this
   * handler is invoked (requirement 7.1).
   *
   * @param body - userId and list of accessible namespaces from apps/app.
   * @returns viewRef and commitOid for the caller to use with git upload-pack.
   */
  async composeView(body) {
    try {
      return await VaultViewComposer.compose(body.userId, body.namespaces);
    } catch (err) {
      this.logger.error('compose-view failed', err);
      throw new InternalServerError(
        err instanceof Error ? err.message : 'compose-view failed',
      );
    }
  }
};
__decorate(
  [
    Post('/'),
    Returns(200).ContentType('application/json'),
    Returns(401),
    Returns(500),
    __param(0, BodyParams()),
    __metadata('design:type', Function),
    __metadata('design:paramtypes', [Object]),
    __metadata('design:returntype', Promise),
  ],
  ComposeViewController.prototype,
  'composeView',
  null,
);
ComposeViewController = __decorate(
  [
    Controller('/internal/compose-view'),
    UseBefore(SharedSecretAuth),
    __metadata('design:paramtypes', [Logger]),
  ],
  ComposeViewController,
);

export { ComposeViewController };
//# sourceMappingURL=compose-view-controller.js.map
