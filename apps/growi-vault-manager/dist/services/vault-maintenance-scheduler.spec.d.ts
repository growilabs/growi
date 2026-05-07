/**
 * Unit tests for VaultMaintenanceScheduler (Task 10.1 + 10.2)
 *
 * All external dependencies — VaultRepoStorage, VaultNamespaceStateModel,
 * child_process.execFile, and setInterval/clearInterval — are fully mocked
 * so that tests run without a real git repository or MongoDB instance.
 *
 * Test coverage:
 *   Squash track:
 *     - version > threshold  → squash is executed
 *     - version <= threshold → squash is not executed
 *     - elapsed time > age threshold → squash is executed
 *   GC track:
 *     - loose object count > threshold → git gc is executed
 *     - elapsed time since last gc > interval → git gc is executed
 *   Threshold override:
 *     - env vars override defaults
 *   Accessors:
 *     - getLastSquashAt() / getLastGcAt() return correct timestamps
 */
export {};
