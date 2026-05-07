/**
 * HealthController
 *
 * Provides a GET /health liveness probe endpoint for Kubernetes.
 * No authentication is required — k8s must be able to reach this endpoint
 * without credentials.
 *
 * Checks performed:
 *   1. MongoDB connection readyState === 1 (connected)
 *   2. Bare repo directory accessibility (fs.access on VAULT_REPO_PATH)
 *
 * Returns 200 { "status": "ok" } when all checks pass.
 * Returns 503 { "status": "error", "details": { ... } } when any check fails.
 */

import fs from 'node:fs';
import { Controller, Get, Res } from '@tsed/common';
import mongoose from 'mongoose';
import { __decorate, __metadata, __param } from 'tslib';

import { getRepoPath } from '../services/vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
let HealthController = class HealthController {
  /**
   * Liveness probe endpoint.
   *
   * Kubernetes uses this to decide whether the pod should be restarted.
   * All checks must pass for the pod to be considered live.
   */
  async check(res) {
    const details = await this.runChecks();
    const allOk = details.mongo === 'ok' && details.bareRepo === 'ok';
    if (allOk) {
      const body = { status: 'ok' };
      res.status(200).json(body);
    } else {
      const body = { status: 'error', details };
      res.status(503).json(body);
    }
  }
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  /**
   * Runs all health checks concurrently and returns a details object.
   */
  async runChecks() {
    const [mongo, bareRepo] = await Promise.all([
      this.checkMongo(),
      this.checkBareRepo(),
    ]);
    return { mongo, bareRepo };
  }
  /**
   * Checks that Mongoose reports an active connection (readyState === 1).
   */
  checkMongo() {
    // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    return mongoose.connection.readyState === 1 ? 'ok' : 'error';
  }
  /**
   * Checks that the bare repository directory is accessible via fs.access.
   */
  async checkBareRepo() {
    const repoPath = getRepoPath();
    try {
      await fs.promises.access(repoPath, fs.constants.F_OK);
      return 'ok';
    } catch {
      return 'error';
    }
  }
};
__decorate(
  [
    Get('/'),
    __param(0, Res()),
    __metadata('design:type', Function),
    __metadata('design:paramtypes', [Object]),
    __metadata('design:returntype', Promise),
  ],
  HealthController.prototype,
  'check',
  null,
);
HealthController = __decorate([Controller('/health')], HealthController);

export { HealthController };
//# sourceMappingURL=health-controller.js.map
