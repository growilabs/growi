/**
 * Drift guard for the transfer's collection declarations (requirement 7.5).
 *
 * A new collection that nobody classified is transferred by default, because
 * {@link selectTransferableCollections} is a deny-list. That default is the right one —
 * silently skipping content is worse than silently carrying operating state — but it also
 * means nothing tells the author of a new collection that a decision was due. This test
 * is that signal: every collection this codebase knows about has to appear in one of the
 * two declarations, and the failure message names the ones that do not.
 *
 * "Every collection this codebase knows about" is gathered from three places, because no
 * single one of them is complete:
 *   - the database the integration suite is connected to (collections only exist there
 *     once something has written to them, so this alone would miss a brand-new model),
 *   - the Mongoose models this process registers,
 *   - `prisma/schema.prisma` (the owner of `sessions`, `rlflx`, `migrations` and the other
 *     collections that no Mongoose model declares).
 *
 * The check is one-directional on purpose. A declared name that none of the three sources
 * reports is not an error: the `vault_*` collections are declared by the separate
 * growi-vault-manager package and apps/app never registers a model for them.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';

import {
  NON_TRANSFERABLE_COLLECTIONS,
  TRANSFERABLE_COLLECTIONS,
} from './non-transferable-collections';

const PRISMA_SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  '../../../../prisma/schema.prisma',
);

/**
 * `model <name> {` gives the collection name unless the block carries `@@map("...")`,
 * which overrides it (`yjs_writings` -> `yjs-writings`).
 */
const readPrismaCollectionNames = async (): Promise<string[]> => {
  const schema = await fs.readFile(PRISMA_SCHEMA_PATH, 'utf-8');
  const names: string[] = [];

  for (const block of schema.split(/^model /m).slice(1)) {
    const modelName = block.match(/^(\S+)/)?.[1];
    if (modelName == null) continue;

    const mappedName = block
      .slice(0, block.indexOf('\n}'))
      .match(/@@map\("([^"]+)"\)/)?.[1];
    names.push(mappedName ?? modelName);
  }

  return names;
};

describe('collection declarations vs. the collections this codebase knows about', () => {
  let knownCollectionNames: string[];

  beforeAll(async () => {
    // The page / user model factories subscribe to these emitters while being built.
    await setupModelsDependentOnCrowi(
      mock<Crowi>({
        events: {
          page: new EventEmitter(),
          user: mock<UserEvent>(),
          admin: new EventEmitter(),
        },
      }),
    );
    await setupIndependentModels();

    const db = mongoose.connection.db;
    if (db == null) {
      throw new Error('Expected the integration suite to be connected');
    }

    const [collectionsInDb, collectionsInPrisma] = await Promise.all([
      db.listCollections().toArray(),
      readPrismaCollectionNames(),
    ]);

    knownCollectionNames = [
      ...new Set([
        ...collectionsInDb.map(({ name }) => name),
        ...mongoose
          .modelNames()
          .map(
            (modelName) => mongoose.model(modelName).collection.collectionName,
          ),
        ...collectionsInPrisma,
      ]),
    ].sort();
  }, 60_000);

  test('collects enough to be able to fail', () => {
    // Guard the guard: a collector that silently returned nothing (models not registered,
    // schema moved) would satisfy the assertion below without looking at anything.
    expect(knownCollectionNames).toEqual(
      expect.arrayContaining(['users', 'pages', 'revisions', 'sessions']),
    );
    expect(knownCollectionNames.length).toBeGreaterThan(30);
  });

  test('classifies every collection as transferable or non-transferable', () => {
    const unclassified = knownCollectionNames.filter(
      (collectionName) =>
        !NON_TRANSFERABLE_COLLECTIONS.has(collectionName) &&
        !TRANSFERABLE_COLLECTIONS.has(collectionName),
    );

    expect(
      unclassified,
      'These collections are new to the G2G transfer. Decide for each one whether it ' +
        'holds GROWI content or the operating state of one environment, then add it to ' +
        'TRANSFERABLE_COLLECTIONS or NON_TRANSFERABLE_COLLECTIONS in ' +
        'non-transferable-collections.ts',
    ).toEqual([]);
  });

  test('declares no collection as both transferable and non-transferable', () => {
    const declaredTwice = [...TRANSFERABLE_COLLECTIONS].filter(
      (collectionName) => NON_TRANSFERABLE_COLLECTIONS.has(collectionName),
    );

    expect(declaredTwice).toEqual([]);
  });
});
