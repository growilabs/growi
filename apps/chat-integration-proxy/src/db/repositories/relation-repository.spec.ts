// Nothing on `relation` is encrypted, so these tests are about the other half
// of this repository's job: keeping one workspace's several GROWI pairings
// apart (Requirement 8.1) and mapping columns onto the `Relation` type the
// layers to the right read.
import { mockDeep } from 'vitest-mock-extended';

import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../prisma-client.js';
import {
  createRelationRepository,
  RelationAlreadyExistsError,
} from './relation-repository.js';

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'relation-1',
  installationId: 'installation-1',
  growiUri: 'https://wiki.example.com',
  growiLabel: 'Wiki',
  searchWeight: 1,
  settingsVersion: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('relationRepository (Requirement 8.1)', () => {
  it('returns every GROWI paired with one workspace, not just the first', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([
      row(),
      row({
        id: 'relation-2',
        growiUri: 'https://wiki2.example.com',
        growiLabel: 'Second wiki',
        searchWeight: 3,
      }),
    ]);
    const repository = createRelationRepository(prisma);

    const relations = await repository.listByInstallation('installation-1');

    expect(relations.map((relation) => relation.growiUri)).toEqual([
      'https://wiki.example.com',
      'https://wiki2.example.com',
    ]);
    expect(relations[1].searchWeight).toBe(3);
  });

  it('finds one pairing by installation and GROWI URL together', async () => {
    // `growi_uri` alone is not unique: two workspaces may each pair the same
    // GROWI, and answering with the wrong workspace's relation would sign a
    // request with another workspace's key.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findUnique.mockResolvedValue(row());
    const repository = createRelationRepository(prisma);

    await repository.findByGrowiUri(
      'installation-1',
      'https://wiki.example.com',
    );

    expect(prisma.relation.findUnique.mock.calls[0][0].where).toEqual({
      installationId_growiUri: {
        installationId: 'installation-1',
        growiUri: 'https://wiki.example.com',
      },
    });
  });

  it('maps the stored columns onto the Relation the right-hand layers read', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findUnique.mockResolvedValue(row());
    const repository = createRelationRepository(prisma);

    await expect(repository.findById('relation-1')).resolves.toEqual({
      relationId: 'relation-1',
      installationId: 'installation-1',
      growiUri: 'https://wiki.example.com',
      growiLabel: 'Wiki',
      searchWeight: 1,
      settingsVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('answers null for a relation that does not exist', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findUnique.mockResolvedValue(null);
    const repository = createRelationRepository(prisma);

    await expect(repository.findById('relation-missing')).resolves.toBeNull();
  });

  it('creates a pairing under the installation it was asked for', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.create.mockResolvedValue(row());
    const repository = createRelationRepository(prisma);

    const created = await repository.create({
      installationId: 'installation-1',
      growiUri: 'https://wiki.example.com',
      growiLabel: 'Wiki',
      searchWeight: 1,
      settingsVersion: 0,
    });

    expect(prisma.relation.create.mock.calls[0][0].data).toEqual({
      installationId: 'installation-1',
      growiUri: 'https://wiki.example.com',
      growiLabel: 'Wiki',
      searchWeight: 1,
      settingsVersion: 0,
    });
    expect(created.relationId).toBe('relation-1');
  });

  it('reports the unique-constraint violation as RelationAlreadyExistsError (Requirement 8.5)', async () => {
    // The `(installation_id, growi_uri)` constraint is the half of the
    // double-pairing defence that survives a race: two submissions may both
    // look first, both find nothing, and both try to create. The loser has to
    // come back as something `PairingService` can answer `already-paired` to,
    // and only this repository may see the Prisma error -- `src/generated/**`
    // is importable from `db/` alone (`architecture.spec.ts` guard 3).
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`installation_id`,`growi_uri`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['installation_id', 'growi_uri'] },
        },
      ),
    );
    const repository = createRelationRepository(prisma);

    const failure = await repository
      .create({
        installationId: 'installation-1',
        growiUri: 'https://wiki.example.com',
        growiLabel: 'Wiki',
        searchWeight: 1,
        settingsVersion: 0,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(RelationAlreadyExistsError);
    // Which pairing collided is carried through, so the caller can name it
    // without re-reading the row.
    expect(failure).toMatchObject({
      installationId: 'installation-1',
      growiUri: 'https://wiki.example.com',
    });
  });

  it('lets any other failure through untranslated', async () => {
    // The translation must be a decision about the CODE, not a blanket
    // catch: reporting a dropped connection or a constraint on some other
    // column as `already-paired` would answer a submission that never paired
    // with the result of one that did.
    const prisma = mockDeep<PrismaClient>();
    const newRelation = {
      installationId: 'installation-1',
      growiUri: 'https://wiki.example.com',
      growiLabel: 'Wiki',
      searchWeight: 1,
      settingsVersion: 0,
    };

    const otherPrismaError = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed on the field: `installation_id`',
      { code: 'P2003', clientVersion: 'test' },
    );
    prisma.relation.create.mockRejectedValue(otherPrismaError);
    await expect(
      createRelationRepository(prisma).create(newRelation),
    ).rejects.toBe(otherPrismaError);

    const notPrisma = new Error('connection lost');
    prisma.relation.create.mockRejectedValue(notPrisma);
    await expect(
      createRelationRepository(prisma).create(newRelation),
    ).rejects.toBe(notPrisma);
  });
});

describe('relationRepository.updateSearchWeight (Requirement 3.8)', () => {
  it('writes the weight of exactly one relation, addressed by its id', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.update.mockResolvedValue(row({ searchWeight: 5 }));

    await createRelationRepository(prisma).updateSearchWeight('relation-1', 5);

    expect(prisma.relation.update).toHaveBeenCalledWith({
      where: { id: 'relation-1' },
      data: { searchWeight: 5 },
    });
  });
});

describe('relationRepository.bumpSettingsVersionIfNewer (Requirement 11.4)', () => {
  // design.md: 「設定の版が自分の持つものより大きいときだけ書く」. Expressed as a
  // condition ON the update rather than a read followed by a write: two pushes
  // that both read the old version would otherwise both write, and whichever
  // finished last would win regardless of its version -- which is the exact
  // thing the version rule exists to prevent.
  it('updates only while the stored version is strictly smaller', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      createRelationRepository(prisma).bumpSettingsVersionIfNewer(
        'relation-1',
        7,
      ),
    ).resolves.toBe(true);

    expect(prisma.relation.updateMany).toHaveBeenCalledWith({
      where: { id: 'relation-1', settingsVersion: { lt: 7 } },
      data: { settingsVersion: 7 },
    });
  });

  it('answers false when no row matched, so the caller writes nothing', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      createRelationRepository(prisma).bumpSettingsVersionIfNewer(
        'relation-1',
        2,
      ),
    ).resolves.toBe(false);
  });
});
