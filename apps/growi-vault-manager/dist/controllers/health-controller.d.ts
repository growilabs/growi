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
import type { Response } from 'express';
export declare class HealthController {
  /**
   * Liveness probe endpoint.
   *
   * Kubernetes uses this to decide whether the pod should be restarted.
   * All checks must pass for the pod to be considered live.
   */
  check(res: Response): Promise<void>;
  /**
   * Runs all health checks concurrently and returns a details object.
   */
  private runChecks;
  /**
   * Checks that Mongoose reports an active connection (readyState === 1).
   */
  private checkMongo;
  /**
   * Checks that the bare repository directory is accessible via fs.access.
   */
  private checkBareRepo;
}
