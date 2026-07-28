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
import type { Response } from 'express';
import mongoose from 'mongoose';

import { getRepoPath } from '../services/vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HealthCheckDetails {
  readonly mongo: 'ok' | 'error';
  readonly bareRepo: 'ok' | 'error';
}

interface HealthOkResponse {
  readonly status: 'ok';
}

interface HealthErrorResponse {
  readonly status: 'error';
  readonly details: HealthCheckDetails;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('/health')
export class HealthController {
  /**
   * Liveness probe endpoint.
   *
   * Kubernetes uses this to decide whether the pod should be restarted.
   * All checks must pass for the pod to be considered live.
   */
  @Get('/')
  async check(@Res() res: Response): Promise<void> {
    const details = await this.runChecks();

    const allOk = details.mongo === 'ok' && details.bareRepo === 'ok';

    if (allOk) {
      const body: HealthOkResponse = { status: 'ok' };
      res.status(200).json(body);
    } else {
      const body: HealthErrorResponse = { status: 'error', details };
      res.status(503).json(body);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Runs all health checks concurrently and returns a details object.
   */
  private async runChecks(): Promise<HealthCheckDetails> {
    const [mongo, bareRepo] = await Promise.all([
      this.checkMongo(),
      this.checkBareRepo(),
    ]);

    return { mongo, bareRepo };
  }

  /**
   * Checks that Mongoose reports an active connection (readyState === 1).
   */
  private checkMongo(): 'ok' | 'error' {
    // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    return mongoose.connection.readyState === 1 ? 'ok' : 'error';
  }

  /**
   * Checks that the bare repository directory is accessible via fs.access.
   */
  private async checkBareRepo(): Promise<'ok' | 'error'> {
    const repoPath = getRepoPath();
    try {
      await fs.promises.access(repoPath, fs.constants.F_OK);
      return 'ok';
    } catch {
      return 'error';
    }
  }
}
