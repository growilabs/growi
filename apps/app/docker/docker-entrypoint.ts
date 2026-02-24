/**
 * Docker entrypoint for GROWI (TypeScript)
 *
 * Runs directly with Node.js 24 native type stripping.
 * Uses only erasable TypeScript syntax (no enums, no namespaces).
 *
 * Responsibilities:
 * - Directory setup (as root): /data/uploads, symlinks, /tmp/page-bulk-export
 * - Heap size detection: GROWI_HEAP_SIZE → cgroup auto-calc → V8 default
 * - Privilege drop: process.setgid + process.setuid (root → node)
 * - Migration execution: execFileSync (no shell)
 * - App process spawn: spawn with signal forwarding
 */

/** biome-ignore-all lint/suspicious/noConsole: Allow printing to console */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

// -- Constants --

const NODE_UID = 1000;
const NODE_GID = 1000;
const CGROUP_V2_PATH = '/sys/fs/cgroup/memory.max';
const CGROUP_V1_PATH = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
const CGROUP_V1_UNLIMITED_THRESHOLD = 64 * 1024 * 1024 * 1024; // 64GB
const HEAP_RATIO = 0.6;

// -- Exported utility functions --

/**
 * Recursively chown a directory and all its contents.
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
 * Read a cgroup memory limit file and return the numeric value in bytes.
 * Returns undefined if the file cannot be read or the value is "max" / NaN.
 */
export function readCgroupLimit(filePath: string): number | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content === 'max') return undefined;
    const value = parseInt(content, 10);
    if (Number.isNaN(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Detect heap size (MB) using 3-level fallback:
 * 1. GROWI_HEAP_SIZE env var
 * 2. cgroup v2/v1 auto-calculation (60% of limit)
 * 3. undefined (V8 default)
 */
export function detectHeapSize(): number | undefined {
  // Priority 1: GROWI_HEAP_SIZE env
  const envValue = process.env.GROWI_HEAP_SIZE;
  if (envValue != null && envValue !== '') {
    const parsed = parseInt(envValue, 10);
    if (Number.isNaN(parsed)) {
      console.error(
        `[entrypoint] GROWI_HEAP_SIZE="${envValue}" is not a valid number, ignoring`,
      );
      return undefined;
    }
    return parsed;
  }

  // Priority 2: cgroup v2
  const cgroupV2 = readCgroupLimit(CGROUP_V2_PATH);
  if (cgroupV2 != null) {
    return Math.floor((cgroupV2 / 1024 / 1024) * HEAP_RATIO);
  }

  // Priority 3: cgroup v1 (treat > 64GB as unlimited)
  const cgroupV1 = readCgroupLimit(CGROUP_V1_PATH);
  if (cgroupV1 != null && cgroupV1 < CGROUP_V1_UNLIMITED_THRESHOLD) {
    return Math.floor((cgroupV1 / 1024 / 1024) * HEAP_RATIO);
  }

  // Priority 4: V8 default
  return undefined;
}

/**
 * Build Node.js flags array based on heap size and environment variables.
 */
export function buildNodeFlags(heapSize: number | undefined): string[] {
  const flags: string[] = ['--expose_gc'];

  if (heapSize != null) {
    flags.push(`--max-heap-size=${heapSize}`);
  }

  if (process.env.GROWI_OPTIMIZE_MEMORY === 'true') {
    flags.push('--optimize-for-size');
  }

  if (process.env.GROWI_LITE_MODE === 'true') {
    flags.push('--lite-mode');
  }

  return flags;
}

/**
 * Setup required directories (as root).
 * - /data/uploads with symlink to ./public/uploads
 * - /tmp/page-bulk-export with mode 700
 */
export function setupDirectories(
  uploadsDir: string,
  publicUploadsLink: string,
  bulkExportDir: string,
): void {
  // /data/uploads
  fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(publicUploadsLink)) {
    fs.symlinkSync(uploadsDir, publicUploadsLink);
  }
  chownRecursive(uploadsDir, NODE_UID, NODE_GID);
  fs.lchownSync(publicUploadsLink, NODE_UID, NODE_GID);

  // /tmp/page-bulk-export
  fs.mkdirSync(bulkExportDir, { recursive: true });
  chownRecursive(bulkExportDir, NODE_UID, NODE_GID);
  fs.chmodSync(bulkExportDir, 0o700);
}

/**
 * Drop privileges from root to node user.
 * These APIs are POSIX-only and guaranteed to exist in the Docker container (Linux).
 */
export function dropPrivileges(): void {
  if (process.setgid == null || process.setuid == null) {
    throw new Error('Privilege drop APIs not available (non-POSIX platform)');
  }
  process.setgid(NODE_GID);
  process.setuid(NODE_UID);
}

/**
 * Log applied Node.js flags to stdout.
 */
function logFlags(heapSize: number | undefined, flags: string[]): void {
  const source = (() => {
    if (
      process.env.GROWI_HEAP_SIZE != null &&
      process.env.GROWI_HEAP_SIZE !== ''
    ) {
      return 'GROWI_HEAP_SIZE env';
    }
    if (heapSize != null) return 'cgroup auto-detection';
    return 'V8 default (no heap limit)';
  })();

  console.log(`[entrypoint] Heap size source: ${source}`);
  console.log(`[entrypoint] Node.js flags: ${flags.join(' ')}`);
}

/**
 * Run database migration via execFileSync (no shell needed).
 * Equivalent to: node -r dotenv-flow/config node_modules/migrate-mongo/bin/migrate-mongo up -f config/migrate-mongo-config.js
 */
function runMigration(): void {
  console.log('[entrypoint] Running migration...');
  execFileSync(
    process.execPath,
    [
      '-r',
      'dotenv-flow/config',
      'node_modules/migrate-mongo/bin/migrate-mongo',
      'up',
      '-f',
      'config/migrate-mongo-config.js',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    },
  );
  console.log('[entrypoint] Migration completed');
}

/**
 * Spawn the application process and forward signals.
 */
function spawnApp(nodeFlags: string[]): void {
  const child = spawn(
    process.execPath,
    [...nodeFlags, '-r', 'dotenv-flow/config', 'dist/server/app.js'],
    {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    },
  );

  // PID 1 signal forwarding
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  for (const sig of signals) {
    process.on(sig, () => child.kill(sig));
  }

  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    process.exit(code ?? (signal === 'SIGTERM' ? 0 : 1));
  });
}

// -- Main entrypoint --

function main(): void {
  try {
    // Step 1: Directory setup (as root)
    setupDirectories(
      '/data/uploads',
      './public/uploads',
      '/tmp/page-bulk-export',
    );

    // Step 2: Detect heap size and build flags
    const heapSize = detectHeapSize();
    const nodeFlags = buildNodeFlags(heapSize);
    logFlags(heapSize, nodeFlags);

    // Step 3: Drop privileges (root → node)
    dropPrivileges();

    // Step 4: Run migration
    runMigration();

    // Step 5: Start application
    spawnApp(nodeFlags);
  } catch (err) {
    console.error('[entrypoint] Fatal error:', err);
    process.exit(1);
  }
}

// Run main only when executed directly (not when imported for testing)
const isMainModule =
  process.argv[1] != null &&
  (process.argv[1].endsWith('docker-entrypoint.ts') ||
    process.argv[1].endsWith('docker-entrypoint.js'));

if (isMainModule) {
  main();
}
