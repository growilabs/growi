/**
 * Unit tests for HealthController
 *
 * Mongoose connection state and fs.promises.access are mocked so that
 * tests run without a real MongoDB or filesystem.
 */

import type { Response } from 'express';
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../services/vault-repo-storage.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../services/vault-repo-storage.js')>();
  return {
    ...actual,
    getRepoPath: vi.fn(() => '/data/vault-repo.git'),
  };
});

// ---------------------------------------------------------------------------
// Module under test (imported after mocks are declared)
// ---------------------------------------------------------------------------

import { HealthController } from './health-controller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
}

/**
 * Sets mongoose.connection.readyState to the given value.
 * mongoose.connection is a getter-backed property on the Connection prototype,
 * so we target the object directly via vi.spyOn on the prototype.
 */
function setMongoReadyState(value: number): void {
  Object.defineProperty(mongoose.connection, 'readyState', {
    value,
    configurable: true,
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthController', () => {
  let controller: HealthController;
  let accessSpy: { mockRejectedValue: (v: unknown) => void };

  beforeEach(async () => {
    controller = new HealthController();
    // Default: fs.access succeeds (repo exists)
    const fsModule = await import('node:fs');
    accessSpy = vi
      .spyOn(fsModule.promises, 'access')
      .mockResolvedValue(undefined);
    // Default: MongoDB connected
    setMongoReadyState(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('when all checks pass', () => {
    it('responds with 200 and { status: "ok" }', async () => {
      const { res, status, json } = makeRes();

      await controller.check(res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ status: 'ok' });
    });
  });

  // -------------------------------------------------------------------------
  // MongoDB failure
  // -------------------------------------------------------------------------

  describe('when MongoDB is disconnected', () => {
    it('responds with 503 and details.mongo === "error"', async () => {
      setMongoReadyState(0); // disconnected

      const { res, status, json } = makeRes();

      await controller.check(res);

      expect(status).toHaveBeenCalledWith(503);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          details: expect.objectContaining({ mongo: 'error' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Bare repo directory missing
  // -------------------------------------------------------------------------

  describe('when the bare repo directory is inaccessible', () => {
    it('responds with 503 and details.bareRepo === "error"', async () => {
      accessSpy.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );

      const { res, status, json } = makeRes();

      await controller.check(res);

      expect(status).toHaveBeenCalledWith(503);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          details: expect.objectContaining({ bareRepo: 'error' }),
        }),
      );
    });
  });
});
