/**
 * Spawn the built vault-manager as a child process so the integ tests exercise
 * the real RPC + git pack-data path. We re-use the existing dist build that
 * `turbo run build --filter @growi/vault-manager` produces.
 *
 * The function returns a handle the provisioner can use to kill the child on
 * teardown. If the dist build is missing we fail loudly with the build command
 * — auto-building from here would surprise developers running a single test.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface VaultManagerHandle {
  readonly endpoint: string;
  readonly port: number;
  readonly repoPath: string;
  readonly logFile: string;
  readonly kill: () => Promise<void>;
}

const VAULT_MANAGER_DIR = path.resolve(
  __dirname,
  '../../../../growi-vault-manager',
);
const VAULT_MANAGER_DIST = path.join(VAULT_MANAGER_DIR, 'dist/index.js');

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr == null || typeof addr === 'string') {
        reject(new Error('failed to get free port'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(
  endpoint: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${endpoint}/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `vault-manager did not become healthy within ${timeoutMs}ms at ${endpoint}: ${String(lastErr)}`,
  );
}

export async function spawnVaultManager(opts: {
  mongoUri: string;
  internalSecret: string;
}): Promise<VaultManagerHandle> {
  if (!existsSync(VAULT_MANAGER_DIST)) {
    throw new Error(
      `vault-manager dist not found at ${VAULT_MANAGER_DIST}. ` +
        'Run `turbo run build --filter @growi/vault-manager` before running these tests.',
    );
  }

  const port = await findFreePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const repoPath = await mkdtemp(path.join(tmpdir(), 'vault-e2e-repo-'));

  const logDir = path.join(tmpdir(), 'vault-e2e');
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `vault-manager-${port}.log`);
  const logStream = createWriteStream(logFile);

  const child: ChildProcess = spawn('node', [VAULT_MANAGER_DIST], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      MONGO_URI: opts.mongoUri,
      VAULT_REPO_PATH: repoPath,
      VAULT_MANAGER_INTERNAL_SECRET: opts.internalSecret,
      // Short tick so maintenance probes don't slow the test suite down.
      VAULT_MAINTENANCE_TICK_MS: '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  const exitPromise = new Promise<void>((resolve, reject) => {
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL') {
        resolve();
      } else {
        reject(
          new Error(
            `vault-manager exited unexpectedly (code=${code} signal=${signal}). See ${logFile}.`,
          ),
        );
      }
    });
  });

  try {
    await waitForHealth(endpoint, 30_000);
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }

  const kill = async (): Promise<void> => {
    if (child.exitCode != null || child.killed) return;
    child.kill('SIGTERM');
    await Promise.race([
      exitPromise,
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    if (child.exitCode == null) child.kill('SIGKILL');
  };

  return { endpoint, port, repoPath, logFile, kill };
}
