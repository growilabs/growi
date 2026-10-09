// This proxy's own signing keys. The invariant these tests exist to pin down
// is design.md's 「復号は `own-key-repository` の中だけで行い、この層より外へ
// 秘密鍵の値を持ち出さない」: no function on this repository hands a caller the
// decrypted PEM. `loadSigner` returns a `KeyObject` -- the shape design.md
// declares for `RelationKeyService.signerFor` -- and every listing function
// returns records with no key material on them at all.
import { generateKeyPairSync } from 'node:crypto';
import { mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../prisma-client.js';
import { createOwnKeyRepository } from './own-key-repository.js';
import { testCipher } from './test-cipher.js';

const { privateKey } = generateKeyPairSync('ed25519');
const PRIVATE_PEM = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();

const NOW = new Date('2026-06-01T00:00:00.000Z');

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'own-key-row-1',
  relationId: 'relation-1',
  keyId: 'proxy-key-1',
  privateKeyPem: testCipher.encrypt(PRIVATE_PEM),
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  revokedAt: null,
  supersededKeyId: null,
  deliveredToPeerAt: null,
  ...overrides,
});

describe('ownKeyRepository.issue (Requirement 10.6)', () => {
  it('hands the database ciphertext, never the private key itself', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.create.mockResolvedValue(row());
    const repository = createOwnKeyRepository(prisma, testCipher);

    await repository.issue('relation-1', {
      keyId: 'proxy-key-1',
      privateKeyPem: PRIVATE_PEM,
      validFrom: NOW,
      supersededKeyId: null,
    });

    const stored = prisma.ownKey.create.mock.calls[0][0].data
      .privateKeyPem as string;
    expect(stored).not.toContain('BEGIN PRIVATE KEY');
    expect(stored).not.toContain(PRIVATE_PEM);
    expect(testCipher.decrypt(stored)).toBe(PRIVATE_PEM);
  });

  it('records the rotation state the four ordered steps read', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.create.mockResolvedValue(row());
    const repository = createOwnKeyRepository(prisma, testCipher);

    await repository.issue('relation-1', {
      keyId: 'proxy-key-2',
      privateKeyPem: PRIVATE_PEM,
      validFrom: NOW,
      supersededKeyId: 'proxy-key-1',
    });

    const { data } = prisma.ownKey.create.mock.calls[0][0];
    expect(data.supersededKeyId).toBe('proxy-key-1');
    expect(data.deliveredToPeerAt).toBeUndefined();
  });
});

describe('ownKeyRepository.loadSigner — decryption stops here', () => {
  it('returns a signing key object, and no PEM anywhere on the result', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findUnique.mockResolvedValue(row());
    const repository = createOwnKeyRepository(prisma, testCipher);

    const signer = await repository.loadSigner({
      relationId: 'relation-1',
      keyId: 'proxy-key-1',
    });

    expect(signer?.privateKey.type).toBe('private');
    expect(signer?.privateKey.asymmetricKeyType).toBe('ed25519');
    expect(signer?.key).toEqual({
      relationId: 'relation-1',
      keyId: 'proxy-key-1',
    });
    expect(Object.keys(signer ?? {}).sort()).toEqual(['key', 'privateKey']);
  });

  it('is addressed by relation and keyId together, never keyId alone', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findUnique.mockResolvedValue(row());
    const repository = createOwnKeyRepository(prisma, testCipher);

    await repository.loadSigner({
      relationId: 'relation-1',
      keyId: 'proxy-key-1',
    });

    expect(prisma.ownKey.findUnique.mock.calls[0][0].where).toEqual({
      relationId_keyId: { relationId: 'relation-1', keyId: 'proxy-key-1' },
    });
  });

  it('answers null for a key this proxy never issued', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findUnique.mockResolvedValue(null);
    const repository = createOwnKeyRepository(prisma, testCipher);

    await expect(
      repository.loadSigner({ relationId: 'relation-1', keyId: 'nope' }),
    ).resolves.toBeNull();
  });

  it('refuses a row that was altered in the database', async () => {
    const prisma = mockDeep<PrismaClient>();
    const stored = testCipher.encrypt(PRIVATE_PEM);
    prisma.ownKey.findUnique.mockResolvedValue(
      row({ privateKeyPem: `${stored.slice(0, -4)}AAAA` }),
    );
    const repository = createOwnKeyRepository(prisma, testCipher);

    await expect(
      repository.loadSigner({ relationId: 'relation-1', keyId: 'proxy-key-1' }),
    ).rejects.toThrow();
  });
});

describe('ownKeyRepository.listKeys (Requirement 10.5)', () => {
  it('reports both keys of a rotation in progress, with no key material', async () => {
    // Step 1 of the rotation writes the new key while the old one stays valid,
    // so both must come back -- and neither may carry the private key.
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findMany.mockResolvedValue([
      row(),
      row({
        id: 'own-key-row-2',
        keyId: 'proxy-key-2',
        validFrom: new Date('2026-05-01T00:00:00.000Z'),
        supersededKeyId: 'proxy-key-1',
      }),
    ]);
    const repository = createOwnKeyRepository(prisma, testCipher);

    const keys = await repository.listKeys('relation-1');

    expect(keys).toEqual([
      {
        keyId: 'proxy-key-1',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        revokedAt: null,
        supersededKeyId: null,
        deliveredToPeerAt: null,
      },
      {
        keyId: 'proxy-key-2',
        validFrom: new Date('2026-05-01T00:00:00.000Z'),
        revokedAt: null,
        supersededKeyId: 'proxy-key-1',
        deliveredToPeerAt: null,
      },
    ]);
    expect(JSON.stringify(keys)).not.toContain('privateKey');
  });
});

describe('ownKeyRepository rotation bookkeeping (Requirement 10.5)', () => {
  it('marks one key as accepted by the peer', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.update.mockResolvedValue(row());
    const repository = createOwnKeyRepository(prisma, testCipher);

    await repository.markDeliveredToPeer(
      { relationId: 'relation-1', keyId: 'proxy-key-2' },
      NOW,
    );

    expect(prisma.ownKey.update.mock.calls[0][0]).toEqual({
      where: {
        relationId_keyId: { relationId: 'relation-1', keyId: 'proxy-key-2' },
      },
      data: { deliveredToPeerAt: NOW },
    });
  });

  it('revokes one key by closing its validity, not by deleting the row', async () => {
    // The row has to survive: `judgeKeyRevocation` counts revoked keys, and a
    // deleted key would read as one that was never issued.
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.update.mockResolvedValue(row());
    const repository = createOwnKeyRepository(prisma, testCipher);

    await repository.revoke(
      { relationId: 'relation-1', keyId: 'proxy-key-1' },
      NOW,
    );

    expect(prisma.ownKey.update.mock.calls[0][0].data).toEqual({
      revokedAt: NOW,
    });
    expect(prisma.ownKey.delete).not.toHaveBeenCalled();
  });
});

describe('ownKeyRepository.deleteByRelation', () => {
  it('deletes every key of the relation and answers the count removed', async () => {
    // Unpairing and installation removal both require that no private key
    // survives the relation, so this deletes rows rather than revoking them.
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.deleteMany.mockResolvedValue({ count: 2 });
    const repository = createOwnKeyRepository(prisma, testCipher);

    await expect(repository.deleteByRelation('relation-1')).resolves.toBe(2);
    expect(prisma.ownKey.deleteMany).toHaveBeenCalledWith({
      where: { relationId: 'relation-1' },
    });
  });
});
