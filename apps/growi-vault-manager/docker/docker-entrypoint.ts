/**
 * Docker entrypoint for growi-vault-manager.
 *
 * Run directly by Node.js 24 native type stripping (no build step): the image
 * COPYs this file to /docker-entrypoint.ts and runs `node /docker-entrypoint.ts`
 * (see apps/growi-vault-manager/Dockerfile). Uses only erasable TypeScript syntax
 * (no enums / namespaces) so it is kept out of the compiled `dist/` artifact.
 *
 * Why an entrypoint instead of `CMD ["node", "dist/index.js"]`:
 * the bare repo (VAULT_REPO_PATH, default `/data/vault-repo.git`) lives on the
 * `/data` volume that is SHARED with apps/app (requirement 10.3). apps/app runs
 * as the `node` user (uid/gid 1000); if vault-manager ran as root, every git
 * object it writes would be root-owned and unreadable by apps/app, and vice
 * versa. The container therefore starts as root only long enough to create the
 * repo directory and hand it to `node`, then drops to uid/gid 1000 (matching
 * apps/app/docker/docker-entrypoint.ts) before exec'ing the app.
 *
 * Privilege drop uses Node's native `process.setuid/setgid` — no external
 * binary (gosu/setpriv) is required in the runtime image.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';

// The node user shipped by the base image. Must match apps/app so both services
// share the /data volume under a single uid/gid.
const NODE_UID = 1000;
const NODE_GID = 1000;

/**
 * Default bare-repo path. MUST stay in sync with `resolveRepoPath()` in
 * services/vault-repo-storage.ts — the app derives the same value at runtime, so
 * the directory prepared here has to be exactly the one the app writes into.
 */
const DEFAULT_REPO_PATH = '/data/vault-repo.git';

/**
 * Resolve the bare-repo directory from VAULT_REPO_PATH, mirroring the app's own
 * resolution (env overrides the shared-volume default).
 */
export function resolveRepoPath(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.VAULT_REPO_PATH;
  return value != null && value !== '' ? value : DEFAULT_REPO_PATH;
}

/**
 * Recursively chown a directory and all of its contents.
 */
export function chownRecursive(
  dirPath: string,
  uid: number,
  gid: number,
): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = `${dirPath}/${entry.name}`;
    if (entry.isDirectory()) {
      chownRecursive(fullPath, uid, gid);
    } else {
      fs.chownSync(fullPath, uid, gid);
    }
  }
  fs.chownSync(dirPath, uid, gid);
}

/**
 * Ensure the bare-repo directory exists and is owned by the node user (run as
 * root, before the privilege drop).
 *
 * The app later calls `fs.mkdir(repoPath, { recursive: true })`, which becomes a
 * no-op once this has run. Pre-creating and chowning the directory (recursively,
 * so a repo left behind by a previous root-era run is reclaimed) means every
 * object the app subsequently writes lands node-owned and the shared /data
 * volume stays readable by apps/app.
 */
export function ensureRepoDir(repoPath: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  chownRecursive(repoPath, NODE_UID, NODE_GID);
}

/**
 * Drop privileges from root to the node user.
 *
 * POSIX-only APIs, guaranteed present in the Linux runtime image. `setgid` MUST
 * precede `setuid`: once the uid is dropped the process can no longer change its
 * gid.
 */
export function dropPrivileges(): void {
  if (process.setgid == null || process.setuid == null) {
    throw new Error('Privilege drop APIs not available (non-POSIX platform)');
  }
  process.setgid(NODE_GID);
  process.setuid(NODE_UID);
}

/**
 * Spawn the application process and forward signals (PID 1 responsibility).
 */
function spawnApp(): void {
  const child = spawn(process.execPath, ['dist/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  for (const sig of signals) {
    process.on(sig, () => child.kill(sig));
  }

  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    process.exit(code ?? (signal === 'SIGTERM' ? 0 : 1));
  });
}

function main(): void {
  try {
    ensureRepoDir(resolveRepoPath());
    dropPrivileges();
    spawnApp();
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: the entrypoint is a standalone root bootstrap that runs before the application logger exists
    console.error('[entrypoint] Fatal error:', err);
    process.exit(1);
  }
}

// Run main only when executed directly (not when imported by the spec).
const isMainModule =
  process.argv[1] != null &&
  (process.argv[1].endsWith('docker-entrypoint.js') ||
    process.argv[1].endsWith('docker-entrypoint.ts'));

if (isMainModule) {
  main();
}
