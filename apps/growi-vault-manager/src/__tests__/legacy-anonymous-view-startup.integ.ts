/**
 * Integration test for what vault-manager startup does to an `anonymous-view`
 * left behind by an earlier version (see design.md, 起動時の片付け).
 *
 * The data is seeded while this worker's server is stopped, so the assertions
 * observe the real boot path in server-runtime.ts.
 *
 * This test suite is enabled only when RUN_VAULT_INTEG=true is set.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import {
  ensureNamespaceHead,
  getRepoPath,
  writeBlob,
  writeCommit,
  writeTree,
} from '../services/vault-repo-storage.js';
import { restartIntegServer } from './setup/integ-server.js';

const execFileAsync = promisify(execFile);

const ANONYMOUS_NAMESPACE = 'anonymous-view';

function mainRef(namespace: string): string {
  return `refs/namespaces/${namespace}/refs/heads/main`;
}

async function seedCommit(): Promise<string> {
  const blob = await writeBlob(Buffer.from('# seeded\n'));
  const tree = await writeTree([
    { mode: '100644', path: 'page.md', oid: blob, type: 'blob' },
  ]);
  const signature = {
    name: 'seed',
    email: 'seed@example.com',
    timestamp: Math.floor(Date.now() / 1000),
  };
  return writeCommit({
    tree,
    parents: [],
    message: 'seed',
    author: signature,
    committer: signature,
  });
}

async function seedNamespace(namespace: string, oid: string): Promise<void> {
  await execFileAsync('git', [
    '--git-dir',
    getRepoPath(),
    'update-ref',
    mainRef(namespace),
    oid,
  ]);
  await ensureNamespaceHead(namespace);
}

/** Resolves a ref through git itself, so a packed ref counts as present. */
async function resolveRef(ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '--git-dir',
      getRepoPath(),
      'rev-parse',
      '--verify',
      '--quiet',
      ref,
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function withSeparateConnection<T>(
  run: (db: NonNullable<mongoose.Connection['db']>) => Promise<T>,
): Promise<T> {
  const uri = process.env.MONGO_URI;
  if (uri == null) {
    throw new Error('MONGO_URI is not set');
  }
  const conn = await mongoose.createConnection(uri).asPromise();
  try {
    if (conn.db == null) {
      throw new Error('Mongoose connection db is not available');
    }
    return await run(conn.db);
  } finally {
    await conn.close();
  }
}

function userViewDoc(userId: string | null, viewRef: string, oid: string) {
  return {
    userId,
    viewRef,
    viewCommitOid: oid,
    mergedTreeOid: oid,
    sourceVersions: { public: oid },
    composedAt: new Date(),
  };
}

(process.env.RUN_VAULT_INTEG === 'true' ? describe : describe.skip)(
  'vault-manager startup with a legacy anonymous-view',
  () => {
    it('removes the anonymous-view ref, HEAD and record, and keeps user views and public', async () => {
      const userId = randomUUID().replace(/-/g, '').slice(0, 24);
      const userNamespace = `user-${userId}-view`;
      let oid = '';

      await restartIntegServer(async () => {
        oid = await seedCommit();
        await seedNamespace(ANONYMOUS_NAMESPACE, oid);
        await seedNamespace(userNamespace, oid);
        await seedNamespace('public', oid);
        await withSeparateConnection(async (db) => {
          await db
            .collection('vault_user_views')
            .insertMany([
              userViewDoc(null, ANONYMOUS_NAMESPACE, oid),
              userViewDoc(userId, userNamespace, oid),
            ]);
        });
        // Guard the seeding itself, so a passing run cannot be vacuous.
        expect(await resolveRef(mainRef(ANONYMOUS_NAMESPACE))).toBe(oid);
      });

      expect(await resolveRef(mainRef(ANONYMOUS_NAMESPACE))).toBeNull();
      expect(
        fs.existsSync(
          path.join(getRepoPath(), 'refs', 'namespaces', ANONYMOUS_NAMESPACE),
        ),
      ).toBe(false);

      expect(await resolveRef(mainRef(userNamespace))).toBe(oid);
      expect(await resolveRef(mainRef('public'))).toBe(oid);
      expect(
        fs.existsSync(
          path.join(getRepoPath(), 'refs', 'namespaces', userNamespace, 'HEAD'),
        ),
      ).toBe(true);

      await withSeparateConnection(async (db) => {
        const views = db.collection('vault_user_views');
        expect(await views.countDocuments({ userId: null })).toBe(0);
        expect(await views.findOne({ userId })).toMatchObject({
          viewRef: userNamespace,
          viewCommitOid: oid,
        });
      });
    });
  },
);
